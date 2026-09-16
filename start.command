#!/bin/zsh
# PCB 获客 Agent — 优先级 A：端到端联调一键启动脚本（macOS 专用）
# 双击可运行；或终端执行 `chmod +x start.command && ./start.command`
# 行为：先校验 PG + Redis，再开 6 个 Terminal 窗口分别跑 scorer/collector/gateway/mailer:dev/mailer:worker/dashboard
# 已在监听的端口会跳过，避免重复拉起；send-worker 重复启动会重复发信，也做进程检测

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

echo "\033[1;36m====== PCB Auto LeadGen — E2E 联调启动 ======\033[0m"
echo "项目根目录: $PROJECT_ROOT"
echo ""

# ---- 1. 环境前置检查 ----
echo "\033[1;33m[1/7] 环境检查...\033[0m"

PG_READY=$(pg_isready -h localhost -p 5432 2>&1 || true)
if echo "$PG_READY" | grep -qE "accepting connections|接受连接"; then
  echo "  ✅ PostgreSQL 5432 运行中"
else
  echo "  ❌ PostgreSQL 未启动 (pg_isready: $PG_READY)"
  echo "     请先: brew services start postgresql  或  docker run -d -p 5432:5432 ..."
  read -k 1 -s "?按任意键退出..."
  exit 1
fi

REDIS_PONG=$(redis-cli -h localhost -p 6379 ping 2>&1 || true)
if [ "$REDIS_PONG" = "PONG" ]; then
  echo "  ✅ Redis 6379 运行中"
else
  echo "  ❌ Redis 未启动 (redis-cli ping: $REDIS_PONG)"
  echo "     请先: brew services start redis  或  docker run -d -p 6379:6379 redis"
  read -k 1 -s "?按任意键退出..."
  exit 1
fi

if command -v pnpm >/dev/null 2>&1; then
  echo "  ✅ pnpm $(pnpm -v) 可用"
else
  echo "  ❌ 未安装 pnpm"
  echo "     请先: npm i -g pnpm (或 brew install pnpm)"
  read -k 1 -s "?按任意键退出..."
  exit 1
fi

if command -v bun >/dev/null 2>&1; then
  echo "  ✅ bun $(bun -v) 可用"
else
  echo "  ❌ 未安装 bun"
  echo "     请先: curl -fsSL https://bun.sh/install | bash"
  read -k 1 -s "?按任意键退出..."
  exit 1
fi

echo ""

# ---- 2. 打开新 Terminal 窗口启动每个服务 ----
# 用 macOS osascript 开新 Terminal 标签/窗口，避免当前窗口被占

OPEN_IN_TAB=true  # true=同一窗口多 Tab；false=每个服务独立窗口

_launch_service() {
  local name="$1"
  local cmd="$2"
  local color="$3"
  local script="
    tell application \"Terminal\"
      activate
      if $OPEN_IN_TAB then
        tell application \"System Events\" to keystroke \"t\" using command down
        delay 0.3
      else
        do script \"\"
      end if
      do script \"cd '$PROJECT_ROOT' && clear && echo '\\033[1;${color}m===== $name =====\\033[0m' && $cmd\" in front window
    end tell
  "
  osascript -e "$script" >/dev/null 2>&1 || true
  sleep 0.6
}

# 端口已在监听则跳过该服务，避免重复启动冲突
_port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

_start_service() {
  local step="$1" label="$2" port="$3" cmd="$4" color="$5"
  echo "\033[1;33m$step 启动 $label ...\033[0m"
  if [ -n "$port" ] && _port_in_use "$port"; then
    echo "  ⏭️  端口 $port 已在监听，跳过（如需重启请先停掉旧进程）"
    return
  fi
  _launch_service "$label" "$cmd" "$color"
}

_start_service "[2/7]" "Scorer :3002" "3002" "pnpm --filter @pcb/scorer dev" "32"
_start_service "[3/7]" "Collector :3004" "3004" "pnpm --filter @pcb/collector dev" "36"
_start_service "[4/7]" "Gateway :3001" "3001" "pnpm --filter @pcb/gateway dev" "36"
_start_service "[5/7]" "Mailer :3003 (HTTP)" "3003" "pnpm --filter @pcb/mailer dev" "35"

echo "\033[1;33m[6/7] 启动 Mailer send-worker (BullMQ)...\033[0m"
if pgrep -f "workers/send-worker.ts" >/dev/null 2>&1; then
  echo "  ⏭️  send-worker 进程已存在，跳过（重复启动会导致重复发信）"
else
  _launch_service "Mailer send-worker" "pnpm --filter @pcb/mailer worker" "33"
fi

_start_service "[7/7]" "Dashboard Vite :5173" "5173" "pnpm --filter @pcb/dashboard dev" "34"

echo ""
echo "\033[1;32m====== 全部启动中 ======\033[0m"
echo "  🧮 Scorer     : http://localhost:3002/health"
echo "  🔎 Collector  : http://localhost:3004/health"
echo "  📡 Gateway    : http://localhost:3001/health"
echo "  📧 Mailer     : http://localhost:3003/health"
echo "  🖥  Dashboard  : http://localhost:5173   (浏览器自动打开...)"
echo ""
echo "  📋 五步链路验收（DeepSeek 已接入；Resend 为 LIVE 模式）："
echo "    1. 线索看板 → 一键采集（默认 \"printed circuit board\"，约 15-30s）"
echo "       横幅显示：搜索命中 / 新建公司 / 提取联系人 / 完成打分；列表有「联系人邮箱」列"
echo "    2. 内容审核 → 选公司 → 画像（DeepSeek 实时生成）→ 生成 A/B 开发信"
echo "    3. 批准并发信 → Resend LIVE：向真实邮箱会真实寄出！"
echo "       演示发送请选 SmartSense IoT（example.com 假域名，不骚扰真人）"
echo "    4. 发送记录 → 状态 queued → sending → sent（30s 自动刷新）"
echo ""

sleep 2
open "http://localhost:5173" 2>/dev/null || true

echo "如需启动 warmup，请新开终端运行：./warmup-start.command"
echo "健康检查：./scripts/health-check.sh"
echo ""
read -k 1 -s "?当前窗口仅作启动提示，可关闭；服务在新开 Tab/窗口运行。按任意键关闭此窗口..."
