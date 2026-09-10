#!/bin/zsh
# PCB 获客 Agent — 优先级 A：端到端联调一键启动脚本（macOS 专用）
# 双击可运行；或终端执行 `chmod +x start.command && ./start.command`
# 行为：先校验 PG + Redis，再开 5 个 Terminal 窗口分别跑 gateway/scorer/mailer:dev/mailer:worker/dashboard

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

echo "\033[1;36m====== PCB Auto LeadGen — E2E 联调启动 ======\033[0m"
echo "项目根目录: $PROJECT_ROOT"
echo ""

# ---- 1. 环境前置检查 ----
echo "\033[1;33m[1/6] 环境检查...\033[0m"

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

echo "\033[1;33m[2/6] 启动 Gateway  :3001 ...\033[0m"
_launch_service "Gateway :3001" "pnpm --filter @pcb/gateway dev" "36"

echo "\033[1;33m[3/6] 启动 Scorer   :3002 ...\033[0m"
_launch_service "Scorer :3002" "pnpm --filter @pcb/scorer dev" "32"

echo "\033[1;33m[4/6] 启动 Mailer   :3003 (HTTP)...\033[0m"
_launch_service "Mailer :3003 (HTTP)" "pnpm --filter @pcb/mailer dev" "35"

echo "\033[1;33m[5/6] 启动 Mailer send-worker (BullMQ)...\033[0m"
_launch_service "Mailer send-worker" "pnpm --filter @pcb/mailer worker" "33"

echo "\033[1;33m[6/6] 启动 Dashboard Vite :5173 ...\033[0m"
_launch_service "Dashboard :5173" "pnpm --filter @pcb/dashboard dev" "34"

echo ""
echo "\033[1;32m====== 全部启动中 ======\033[0m"
echo "  📡 Gateway    : http://localhost:3001/health"
echo "  🧮 Scorer     : http://localhost:3002/health"
echo "  📧 Mailer     : http://localhost:3003/health"
echo "  🖥  Dashboard  : http://localhost:5173   (浏览器自动打开...)"
echo ""
echo "  📋 验收路径（mock 模式无需真实 Resend Key）："
echo "    Tab 1 线索看板 → 确认 A/B/C 卡 + 列表 + 覆盖弹窗"
echo "    Tab 2 内容审核 → 选公司 → 重新画像 → 生成 A/B → 批准并发信"
echo "    Tab 3 发送看板 → 7 统计卡 + warmup 状态 + 活动列表"
echo "    Tab 4 发送记录 → 状态 queued→sending→sent_mock→delivered→opened"
echo ""

sleep 2
open "http://localhost:5173" 2>/dev/null || true

echo "如需启动 warmup，请新开终端运行：./warmup-start.command"
echo "健康检查：./scripts/health-check.sh"
echo ""
read -k 1 -s "?当前窗口仅作启动提示，可关闭；服务在新开 Tab/窗口运行。按任意键关闭此窗口..."
