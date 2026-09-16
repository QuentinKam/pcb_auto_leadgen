#!/usr/bin/env bash
# PCB 服务器一键巡检：8 个服务 /health + PM2 重启计数 + swap/OOM + 公网探测。
# 本机执行（需能 SSH 到服务器）。可用环境变量覆盖：
#   PCB_SSH_KEY=/path/to/key PCB_HOST=root@1.2.3.4 health.sh
set -euo pipefail

KEY="${PCB_SSH_KEY:-/Users/quentingam/Downloads/new_aliyun.pem}"
HOST="${PCB_HOST:-root@47.251.97.20}"
SSH_OPTS=(-i "$KEY" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)

echo "== 远端服务健康 (127.0.0.1) =="
ssh "${SSH_OPTS[@]}" "$HOST" 'bash -s' <<'REMOTE'
set -u
# 名称 端口 成对列出
services=(
  pcb-demo-gateway 3011 pcb-demo-collector 3014 pcb-demo-scorer 3012 pcb-demo-mailer 3013
  pcb-prod-gateway 3021 pcb-prod-collector 3024 pcb-prod-scorer 3022 pcb-prod-mailer 3023
)
for ((i=0; i<${#services[@]}; i+=2)); do
  name="${services[i]}"; port="${services[i+1]}"
  code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/health" || echo 000)
  restarts=$(pm2 jlist 2>/dev/null | node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      const name=process.argv[1];
      const p=JSON.parse(d).find(x=>x.name===name);
      process.stdout.write(p?String(p.pm2_env.restart_time):"NA");
    });' "$name")
  printf '  :%s %-22s health=%s restarts=%s\n' "$port" "$name" "$code" "$restarts"
done

echo
echo "== PM2 PCB 进程 =="
pm2 list | grep -E 'pcb-|name' || true

echo
echo "== 内存 / swap =="
free -m | awk 'NR<=2'
printf 'swappiness=%s  ' "$(cat /proc/sys/vm/swappiness)"
swapon --show | tail -n +2 || echo "(no swap)"

echo
echo "== 最近 3 条 OOM 记录 =="
dmesg -T 2>/dev/null | grep 'Killed process' | tail -3 || echo "(无权限或无记录)"
REMOTE

echo
echo "== 公网探测 =="
for url in http://47.251.97.20:8090/ http://47.251.97.20:8091/; do
  printf '  %s -> %s\n' "$url" "$(curl -s -m 8 -o /dev/null -w '%{http_code}' "$url")"
done
