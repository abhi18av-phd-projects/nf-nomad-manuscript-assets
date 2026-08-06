#!/usr/bin/env bash
# One preemption trial: stop a client that is currently running allocations, then
# measure how long nf-nomad takes to reschedule the affected tasks elsewhere.
#
#   ./scripts/chaos.sh                 one trial, appends a row to trials.tsv
#   TRIALS=10 ./scripts/chaos.sh       ten trials
#
# Emits: trials.tsv — trial, victim, killed_at, rescheduled_at, delta_seconds, completed
#
# This measures SUBSTRATE RECOVERY, not pipeline correctness. Pair it with a workload
# of many short randomised tasks (see ../pipelines/nf-sleep-random) so that a kill lands
# on a task at a random point in its life, and so one run yields many observations.
set -euo pipefail
cd "$(dirname "$0")/.."
export NOMAD_ADDR="${NOMAD_ADDR:-http://127.0.0.1:4646}"
export NOMAD_TOKEN="${NOMAD_TOKEN:-$(cat .nomad-token 2>/dev/null || true)}"
TRIALS="${TRIALS:-1}"
OUT="trials.tsv"
[ -f "$OUT" ] || printf 'trial\tvictim\tkilled_at\trescheduled_at\tdelta_seconds\tcompleted\n' > "$OUT"

nomad_q() { docker compose exec -T nomad-server env NOMAD_TOKEN="$NOMAD_TOKEN" nomad "$@" 2>/dev/null; }

for t in $(seq 1 "$TRIALS"); do
  # Pick a client container that currently holds running allocations.
  victim="$(docker compose ps -q nomad-client | shuf -n1)"
  [ -n "$victim" ] || { echo "no client containers running"; exit 1; }
  vname="$(docker inspect --format '{{.Name}}' "$victim" | tr -d '/')"

  running_before="$(nomad_q job status -json 2>/dev/null | jq '[.[] | select(.Status=="running")] | length' || echo 0)"
  killed_at="$(date -u +%s)"
  docker stop "$victim" >/dev/null
  echo "trial $t: stopped $vname at $(date -u -r "$killed_at" +%H:%M:%S)"

  # Wait for the scheduler to place the affected allocations somewhere else.
  rescheduled_at=""
  for i in $(seq 1 120); do
    pending="$(nomad_q eval list -json 2>/dev/null | jq '[.[] | select(.Status=="pending")] | length' || echo 0)"
    lost="$(nomad_q alloc status -json 2>/dev/null | jq '[.[] | select(.ClientStatus=="lost")] | length' || echo 0)"
    if [ "${pending:-0}" -eq 0 ] && [ "${lost:-0}" -ge 0 ] && [ "$i" -gt 2 ]; then
      rescheduled_at="$(date -u +%s)"; break
    fi
    sleep 1
  done
  rescheduled_at="${rescheduled_at:-$(date -u +%s)}"
  delta=$(( rescheduled_at - killed_at ))

  # Restore the node so the next trial starts from the same shape.
  docker start "$victim" >/dev/null; sleep 5
  completed="$(nomad_q job status -json 2>/dev/null | jq '[.[] | select(.Status=="dead")] | length' || echo 0)"

  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$t" "$vname" "$killed_at" "$rescheduled_at" "$delta" "$completed" >> "$OUT"
  echo "  reschedule took ${delta}s"
done

echo
echo "results → $OUT"
awk -F'\t' 'NR>1{d[NR-1]=$5; s+=$5; n++} END{if(n){asort(d); printf "  n=%d  median=%ss  mean=%.1fs\n", n, d[int((n+1)/2)], s/n}}' "$OUT" 2>/dev/null \
  || awk -F'\t' 'NR>1{s+=$5;n++} END{if(n) printf "  n=%d  mean=%.1fs\n", n, s/n}' "$OUT"
