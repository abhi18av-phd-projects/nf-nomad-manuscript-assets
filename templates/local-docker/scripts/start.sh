#!/usr/bin/env bash
# Bring up the cluster and bootstrap ACLs.  CLIENTS=N to change the node count.
set -euo pipefail
cd "$(dirname "$0")/.."
CLIENTS="${CLIENTS:-3}"
# MinIO is only required by the s5cmd work-dir mode. The reallocation test needs
# scheduling alone, so storage is opt-in:  WITH_STORAGE=1 ./scripts/start.sh
WITH_STORAGE="${WITH_STORAGE:-0}"
PROFILE_ARGS=()
[ "$WITH_STORAGE" = "1" ] && PROFILE_ARGS=(--profile storage)

docker compose "${PROFILE_ARGS[@]}" build
docker compose "${PROFILE_ARGS[@]}" up -d --scale nomad-client="$CLIENTS"

export NOMAD_ADDR="http://127.0.0.1:4646"
echo "waiting for the server…"
for i in $(seq 1 60); do
  curl -sf "$NOMAD_ADDR/v1/status/leader" >/dev/null 2>&1 && break
  sleep 2
  [ "$i" = 60 ] && { echo "server did not become ready"; exit 1; }
done

if [ ! -f .nomad-token ]; then
  docker compose exec -T nomad-server nomad acl bootstrap -json > .bootstrap.json 2>/dev/null || true
  jq -r '.SecretID' .bootstrap.json > .nomad-token 2>/dev/null || true
  chmod 600 .nomad-token .bootstrap.json 2>/dev/null || true
fi
export NOMAD_TOKEN="$(cat .nomad-token 2>/dev/null || true)"

echo "waiting for $CLIENTS clients to register…"
for i in $(seq 1 60); do
  n=$(NOMAD_TOKEN="$NOMAD_TOKEN" docker compose exec -T nomad-server \
        nomad node status -json 2>/dev/null | jq '[.[] | select(.Status=="ready")] | length' 2>/dev/null || echo 0)
  [ "${n:-0}" -ge "$CLIENTS" ] && break
  sleep 2
done

echo
echo "  cluster ready — $CLIENTS clients"
echo "  export NOMAD_ADDR=$NOMAD_ADDR"
echo "  export NOMAD_TOKEN=\$(cat $(pwd)/.nomad-token)"
echo "  UI: $NOMAD_ADDR"
if [ "$WITH_STORAGE" = "1" ]; then
  echo "  MinIO: http://127.0.0.1:9001 (minioadmin/minioadmin)"
else
  echo "  (no object store — WITH_STORAGE=1 adds MinIO for the s5cmd mode)"
fi
