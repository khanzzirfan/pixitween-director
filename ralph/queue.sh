#!/usr/bin/env bash
# Runs Ralph PRDs from a queue file, one at a time, headless, with Sonnet. The queue file
# (debug/ralph/queue.txt, one PRD name per line without the prd- prefix) can be edited while this
# runs: the next name is read only when the previous PRD ends. A PRD that does not end with every
# story passing is retried once (Ralph resumes where it stopped), then moved to the end of the queue.
# Waits for any Ralph already running before starting. Logs: debug/ralph/queue.log, debug/ralph/<prd>.log.
set -u
cd "$(dirname "$0")/.."
mkdir -p debug/ralph
QUEUE=debug/ralph/queue.txt
LOG=debug/ralph/queue.log
touch "$QUEUE"

log() { echo "$(date '+%H:%M:%S') $*" >> "$LOG"; }
passes() { node -e 'const p=require("./ralph/prd-'"$1"'.json");const s=p.userStories;console.log(s.filter(x=>x.passes).length+"/"+s.length)'; }

while pgrep -f "ralph-tui run" > /dev/null; do sleep 20; done

TRIES=debug/ralph/tries
mkdir -p "$TRIES"
while true; do
  name=$(grep -v '^\s*$' "$QUEUE" | head -1)
  if [ -z "$name" ]; then log "QUEUE DONE"; exit 0; fi
  # pop the first line
  grep -v '^\s*$' "$QUEUE" | tail -n +2 > "$QUEUE.tmp" && mv "$QUEUE.tmp" "$QUEUE"
  if [ ! -f "ralph/prd-$name.json" ]; then log "MISSING $name"; continue; fi
  before=$(passes "$name")
  log "START $name ($before)"
  ralph-tui run --prd "./ralph/prd-$name.json" --iterations 0 --headless --model minimax/minimax-m3.1-flash >> "debug/ralph/$name.log" 2>&1
  code=$?
  after=$(passes "$name")
  log "END $name exit=$code passes=$after"
  if [ "${after%/*}" != "${after#*/}" ]; then
    n=$(( $(cat "$TRIES/$name" 2>/dev/null || echo 0) + 1 ))
    echo "$n" > "$TRIES/$name"
    if [ "$n" -le 1 ]; then
      log "RETRY $name next"
      { echo "$name"; cat "$QUEUE"; } > "$QUEUE.tmp" && mv "$QUEUE.tmp" "$QUEUE"
    else
      log "PARKED $name at $after (moved to the end; needs review)"
      echo "$name" >> "$QUEUE"
      sleep 5
    fi
  fi
done
