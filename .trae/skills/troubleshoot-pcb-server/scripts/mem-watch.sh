#!/usr/bin/env bash
# 采样远端某个 PM2 进程的 RSS 与系统内存，用于定位瞬时 OOM（5 秒采样抓不到时用 1-2 秒间隔）。
# 本机执行。用法：
#   mem-watch.sh <pm2进程名> [间隔秒] [次数]
# 例：mem-watch.sh pcb-demo-collector 2 75
set -euo pipefail

NAME="${1:?usage: mem-watch.sh <pm2-process-name> [interval_s] [count]}"
INTERVAL="${2:-2}"
COUNT="${3:-60}"
KEY="${PCB_SSH_KEY:-/Users/quentingam/Downloads/new_aliyun.pem}"
HOST="${PCB_HOST:-root@47.251.97.20}"

ssh -i "$KEY" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "$HOST" \
  NAME="$NAME" INTERVAL="$INTERVAL" COUNT="$COUNT" 'bash -s' <<'REMOTE'
for _ in $(seq 1 "$COUNT"); do
  pid=$(pm2 pid "$NAME" 2>/dev/null || true)
  rss="NA"
  if [ -n "${pid:-}" ] && [ -r "/proc/$pid/status" ]; then
    rss=$(awk '/VmRSS/{print $2}' "/proc/$pid/status")
  fi
  ts=$(date +%H:%M:%S)
  mem=$(free -m | awk '/Mem:/{printf "used=%sMB avail=%sMB", $3, $7}')
  swap=$(free -m | awk '/Swap:/{printf "swap=%sMB", $3}')
  echo "$ts ${NAME} rss=${rss}kB $mem $swap"
  sleep "$INTERVAL"
done
REMOTE
