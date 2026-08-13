#!/usr/bin/env bash
# One preemption trial: stop a client that is currently running allocations, then measure
# how long the scheduler takes to get those specific allocations running again elsewhere.
#
#   ./scripts/chaos.sh                 one trial, appends a row to trials.tsv
#   TRIALS=10 ./scripts/chaos.sh       ten trials
#   JOB=sleeper ./scripts/chaos.sh     which job to disrupt (default: sleeper)
#
# Emits trials.tsv:
#   trial · victim · victim_allocs · killed_at · recovered_at · delta_seconds · replacements · outcome
#
# MEASUREMENT — read this before trusting a number.
# Recovery time is the interval from stopping the node to the moment the job again has its
# full desired count of allocations in the `running` state, with none of them on the node
# that was stopped. That is a claim about the disrupted work being back, and it is checked
# against Nomad's own state rather than assumed.
#
# Two earlier attempts were wrong and are worth recording so they are not repeated:
#   1. Polling for "no pending evaluations" with a minimum wait. It exits after a fixed few
#      seconds whatever the scheduler is doing, and produced a plausible but meaningless 4 s.
#   2. Matching replacements via `PreviousAllocation`. That field is not populated in the
#      `job allocs -json` output of Nomad 1.11.2 (only `RescheduleTracker` exists, and it is
#      null here), so the condition could never be satisfied and every trial timed out.
# If recovery cannot be confirmed within TIMEOUT the row is written as outcome=TIMEOUT with
# no delta, rather than inventing a number.
#
# This measures SUBSTRATE RECOVERY, not pipeline correctness — pair it with
# ../pipelines/nf-sleep-random so kills land at random points in task lifetimes.
set -euo pipefail
cd "$(dirname "$0")/.."

export NOMAD_ADDR="${NOMAD_ADDR:-http://127.0.0.1:4646}"
export NOMAD_TOKEN="${NOMAD_TOKEN:-$(cat .nomad-token 2>/dev/null || true)}"
JOB="${JOB:-sleeper}"
TRIALS="${TRIALS:-1}"
TIMEOUT="${TIMEOUT:-180}"
OUT="trials.tsv"

command -v nomad >/dev/null || { echo "nomad CLI not found on PATH"; exit 1; }
command -v jq    >/dev/null || { echo "jq not found on PATH"; exit 1; }

[ -f "$OUT" ] || printf 'trial\tvictim\tvictim_allocs\tkilled_at\trecovered_at\tdelta_seconds\treplacements\toutcome\n' > "$OUT"

# Portable: GNU date and BSD date disagree on -r, so format from epoch via awk instead.
hhmmss() { awk -v t="$1" 'BEGIN{ print strftime("%H:%M:%S", t) }' 2>/dev/null || echo "$1"; }

allocs_json() { nomad job allocs -json "$JOB" 2>/dev/null || echo '[]'; }

# If the script is interrupted mid-trial the victim container would stay stopped and the
# cluster would be left degraded. Always put it back.
VICTIM_CID=""
restore_victim() {
  [ -n "$VICTIM_CID" ] && docker start "$VICTIM_CID" >/dev/null 2>&1 || true
  VICTIM_CID=""
}
trap restore_victim EXIT INT TERM

for t in $(seq 1 "$TRIALS"); do
  # Choose a victim among containers that actually hold RUNNING allocations, so the trial
  # disrupts real work rather than an idle node.
  mapfile -t busy < <(allocs_json | jq -r '[.[]|select(.ClientStatus=="running")]|group_by(.NodeName)[]|.[0].NodeName' 2>/dev/null)
  [ "${#busy[@]}" -gt 0 ] || { echo "trial $t: no running allocations for job '$JOB' — start a workload first"; exit 1; }
  vnode="${busy[RANDOM % ${#busy[@]}]}"

  # Container whose hostname is that Nomad node name.
  vcid=""
  for c in $(docker compose ps -q nomad-client); do
    [ "$(docker inspect --format '{{.Config.Hostname}}' "$c")" = "$vnode" ] && { vcid="$c"; break; }
  done
  [ -n "$vcid" ] || { echo "trial $t: could not map node $vnode to a container"; exit 1; }

  # How much work is on the victim, and what a healthy job looks like.
  mapfile -t victim_allocs < <(allocs_json | jq -r --arg n "$vnode" '.[]|select(.NodeName==$n and .ClientStatus=="running")|.ID')
  n_victim="${#victim_allocs[@]}"
  desired="$(nomad job inspect "$JOB" 2>/dev/null | jq '[.Job.TaskGroups[].Count]|add' || echo 0)"

  killed_at="$(date -u +%s)"
  VICTIM_CID="$vcid"
  docker stop "$vcid" >/dev/null
  echo "trial $t: stopped $vnode ($n_victim running allocs) at $(hhmmss "$killed_at")"

  # STEP 1 — confirm the kill actually disrupted work. Without this a trial run against an
  # already-degraded cluster satisfies the recovery condition instantly and records a 0 s
  # "recovery" that is pure artefact. Observed for real: trials against a cluster left
  # degraded by an interrupted run produced 0 s and 1 s alongside genuine 26–27 s results.
  disrupted=0
  for _ in $(seq 1 30); do
    now="$(allocs_json | jq --arg n "$vnode" '[.[]|select(.ClientStatus=="running" and .NodeName!=$n)]|length' 2>/dev/null || echo 0)"
    if [ "${now:-0}" -lt "${desired:-0}" ]; then disrupted=1; break; fi
    sleep 1
  done
  if [ "$disrupted" -eq 0 ]; then
    echo "  no disruption observed — the cluster was already at desired count without $vnode."
    echo "  Recorded as NO_DISRUPTION; this is not a recovery measurement."
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$t" "$vnode" "$n_victim" "$killed_at" "" "" "0" "NO_DISRUPTION" >> "$OUT"
    docker start "$vcid" >/dev/null; VICTIM_CID=""
    until [ "$(nomad node status -json 2>/dev/null | jq '[.[]|select(.Status=="ready")]|length' 2>/dev/null || echo 0)" -ge "${#busy[@]}" ]; do sleep 2; done
    continue
  fi

  # STEP 2 — time recovery back to the desired count on surviving nodes.
  recovered_at=""; replaced=0
  for _ in $(seq 1 "$TIMEOUT"); do
    replaced="$(allocs_json | jq --arg n "$vnode" \
      '[.[]|select(.ClientStatus=="running" and .NodeName!=$n)]|length' 2>/dev/null || echo 0)"
    if [ "${replaced:-0}" -ge "${desired:-0}" ]; then recovered_at="$(date -u +%s)"; break; fi
    sleep 1
  done

  if [ -n "$recovered_at" ]; then
    delta=$(( recovered_at - killed_at )); outcome="RECOVERED"
    echo "  recovered in ${delta}s — $replaced/$desired running on surviving nodes ($n_victim were displaced)"
  else
    delta=""; recovered_at=""; outcome="TIMEOUT"
    echo "  NO RECOVERY within ${TIMEOUT}s ($replaced/$desired running) — recorded as TIMEOUT, not as a number"
  fi

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$t" "$vnode" "$n_victim" "$killed_at" "$recovered_at" "$delta" "$replaced" "$outcome" >> "$OUT"

  docker start "$vcid" >/dev/null; VICTIM_CID=""
  until [ "$(nomad node status -json 2>/dev/null | jq '[.[]|select(.Status=="ready")]|length' 2>/dev/null || echo 0)" -ge "${#busy[@]}" ]; do sleep 2; done
done

echo
echo "results → $OUT"
awk -F'\t' 'NR>1 && $8=="RECOVERED"{a[n++]=$6; s+=$6}
  END{ if(n){ for(i=0;i<n;i++) for(j=i+1;j<n;j++) if(a[j]<a[i]){x=a[i];a[i]=a[j];a[j]=x}
    printf "  n=%d recovered  median=%ss  mean=%.1fs  min=%ss  max=%ss\n", n, a[int(n/2)], s/n, a[0], a[n-1] }
    else print "  no recovered trials" }' "$OUT"
awk -F'\t' 'NR>1 && $8=="TIMEOUT"{n++} END{ if(n) printf "  %d trial(s) TIMED OUT and are excluded from the median\n", n }' "$OUT"
awk -F'\t' 'NR>1 && $8=="NO_DISRUPTION"{n++} END{ if(n) printf "  %d trial(s) recorded NO_DISRUPTION (invalid) and are excluded\n", n }' "$OUT"
