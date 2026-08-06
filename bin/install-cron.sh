#!/bin/sh
DIR="$(cd "$(dirname "$0")/.." && pwd)"
MIN="${TASK2WRIST_INTERVAL_MIN:-15}"
CRONTAB_DIR="${CRONTAB_DIR:-/etc/crontabs}"

mkdir -p "$CRONTAB_DIR"
echo "*/$MIN * * * * $DIR/bin/run-sync.sh" > "$CRONTAB_DIR/root"

if ! pidof crond >/dev/null 2>&1; then
  crond -b
  echo "crond started."
else
  echo "crond already running."
fi

echo "Cron installed: every $MIN minutes -> $DIR/bin/run-sync.sh"
