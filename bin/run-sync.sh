#!/bin/sh
DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ -z "$TASK2WRIST_HOME" ]; then
  export TASK2WRIST_HOME="${HOME:-$DIR}/.config/task2wrist"
fi
mkdir -p "$TASK2WRIST_HOME"
exec flock -n "$TASK2WRIST_HOME/sync.lock" \
  node "$DIR/src/cli.js" sync:quiet >> "$TASK2WRIST_HOME/sync.log" 2>&1
