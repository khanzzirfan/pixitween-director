#!/usr/bin/env bash
# Runs Ralph PRDs one after another, in order, headless. Stops at the first PRD that does not end
# with every story passing, so a later PRD never builds on a broken one.
# Usage: ralph/run-queue.sh r2-stage-2d r3-effects ...   (names without the prd- prefix)
# Logs: debug/ralph/<prd>.log; status line per PRD in debug/ralph/queue.log.
set -u
cd "$(dirname "$0")/.."
mkdir -p debug/ralph
QUEUE_LOG=debug/ralph/queue.log

passes() {
  node -e 'const p=require("./ralph/prd-'"$1"'.json");const s=p.userStories;console.log(s.filter(x=>x.passes).length+"/"+s.length)'
}

for name in "$@"; do
  prd="ralph/prd-$name.json"
  if [ ! -f "$prd" ]; then
    echo "$(date '+%H:%M:%S') MISSING $prd" >> "$QUEUE_LOG"
    exit 1
  fi
  before=$(passes "$name")
  echo "$(date '+%H:%M:%S') START $name ($before)" >> "$QUEUE_LOG"
  ralph-tui run --prd "./$prd" --iterations 0 --headless --model sonnet > "debug/ralph/$name.log" 2>&1
  code=$?
  after=$(passes "$name")
  echo "$(date '+%H:%M:%S') END $name exit=$code passes=$after" >> "$QUEUE_LOG"
  done_count=${after%/*}
  total=${after#*/}
  if [ "$done_count" != "$total" ]; then
    echo "$(date '+%H:%M:%S') STOP queue: $name ended at $after" >> "$QUEUE_LOG"
    exit 2
  fi
done
echo "$(date '+%H:%M:%S') QUEUE DONE" >> "$QUEUE_LOG"
