#!/bin/zsh
# PCB 获客 Agent — 客户演示一键准备脚本（macOS 专用）
#
# 双击即可：校验依赖 → 写入演示数据 → 补齐未启动的服务 → 自检 → 打开看板
# 与 start.command 的区别：start.command 是"开发时起服务"，本脚本会先准备演示数据并做就绪自检。
#
# 演示数据全部带标记，随时可用 `pnpm --filter @pcb/scripts demo:reset` 一键清空。

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

C_BOLD='\033[1m'
C_CYAN='\033[1;36m'
C_YELLOW='\033[1;33m'
C_GREEN='\033[1;32m'
C_RED='\033[1;31m'
C_DIM='\033[2m'
C_OFF='\033[0m'

echo ""
echo "${C_CYAN}${C_BOLD}  PCB 获客 Agent — 客户演示一键准备${C_OFF}"
echo "  ${C_DIM}项目根目录: $PROJECT_ROOT${C_OFF}"
echo ""

fail_and_wait() {
  echo ""
  echo "  ${C_RED}✗ $1${C_OFF}"
  echo "  ${C_YELLOW}$2${C_OFF}"
  echo ""
  read -k 1 -s "?  按任意键退出..."
  echo ""
  exit 1
}

port_busy() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

# ---------- 1. 环境检查 ----------
echo "${C_YELLOW}[1/5] 环境检查${C_OFF}"

PG_READY=$(pg_isready -h localhost -p 5432 2>&1 || true)
if echo "$PG_READY" | grep -qE "accepting connections|接受连接"; then
  echo "  ✓ PostgreSQL 5432"
else
  fail_and_wait "PostgreSQL 未启动" "请先执行：brew services start postgresql"
fi

REDIS_PONG=$(redis-cli -h localhost -p 6379 ping 2>&1 || true)
if [ "$REDIS_PONG" = "PONG" ]; then
  echo "  ✓ Redis 6379"
else
  fail_and_wait "Redis 未启动" "请先执行：brew services start redis"
fi

command -v pnpm >/dev/null 2>&1 || fail_and_wait "未安装 pnpm" "请先执行：npm i -g pnpm"
command -v bun  >/dev/null 2>&1 || fail_and_wait "未安装 bun"  "请先执行：curl -fsSL https://bun.sh/install | bash"
echo "  ✓ pnpm $(pnpm -v) / bun $(bun -v)"

# 演示收件邮箱提示（真实发信高光环节的收件人）
DEMO_RECIPIENT=$(grep -E '^DEMO_RECIPIENT_EMAIL=' apps/mailer/.env 2>/dev/null | head -1 | cut -d= -f2- || true)
if [ -n "$DEMO_RECIPIENT" ]; then
  echo "  ✓ 演示收件邮箱：${C_BOLD}${DEMO_RECIPIENT}${C_OFF}"
else
  echo "  ${C_YELLOW}!${C_OFF} 未配置 DEMO_RECIPIENT_EMAIL，真实发信将使用 warmup 种子邮箱里的第一个"
fi
echo ""

# ---------- 2. 演示数据 ----------
echo "${C_YELLOW}[2/5] 准备演示数据${C_OFF}"
echo "  ${C_DIM}清空旧演示数据 → 重新写入（12 家客户 / 打分 / 画像 / A-B 开发信 / 发送记录）${C_OFF}"
bun run scripts/demo/seed.ts --purge-failed 2>&1 | sed 's/^/  /'
echo ""

# ---------- 3. 启动服务（已在跑的不重复启动）----------
echo "${C_YELLOW}[3/5] 检查并补齐服务${C_OFF}"

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

_start_if_down() {
  local port="$1" name="$2" cmd="$3" color="$4"
  if port_busy "$port"; then
    echo "  ${C_DIM}·${C_OFF} $name 已在运行（端口 $port），跳过"
  else
    echo "  ${C_GREEN}▸${C_OFF} 启动 $name ..."
    _launch_service "$name" "$cmd" "$color"
  fi
}

_start_if_down 3001 "Gateway :3001"        "pnpm --filter @pcb/gateway dev"   "36"
_start_if_down 3002 "Scorer :3002"         "pnpm --filter @pcb/scorer dev"    "32"
_start_if_down 3003 "Mailer :3003"         "pnpm --filter @pcb/mailer dev"    "35"

# send-worker 是真实发信高光环节的前提，必须常驻
if pgrep -f "workers/send-worker" >/dev/null 2>&1; then
  echo "  ${C_DIM}·${C_OFF} Mailer send-worker 已在运行，跳过"
else
  echo "  ${C_GREEN}▸${C_OFF} 启动 Mailer send-worker（真实发信必需）..."
  _launch_service "Mailer send-worker" "pnpm --filter @pcb/mailer worker" "33"
fi

_start_if_down 5173 "Dashboard :5173"      "pnpm --filter @pcb/dashboard dev" "34"
echo ""

# ---------- 4. 等待就绪 ----------
echo "${C_YELLOW}[4/5] 等待服务就绪${C_OFF}"
for i in {1..30}; do
  if curl -s -o /dev/null --max-time 2 http://localhost:3001/health \
     && curl -s -o /dev/null --max-time 2 http://localhost:3002/health \
     && curl -s -o /dev/null --max-time 2 http://localhost:3003/health \
     && curl -s -o /dev/null --max-time 2 http://localhost:5173/; then
    echo "  ✓ 四个服务全部就绪（约 ${i} 秒）"
    break
  fi
  printf "  ${C_DIM}等待中 %d/30 ...${C_OFF}\r" "$i"
  sleep 1
  if [ "$i" = "30" ]; then
    echo ""
    echo "  ${C_YELLOW}!${C_OFF} 等待超时，继续做自检（自检会指出哪个服务没起）"
  fi
done
echo ""

# ---------- 5. 自检 ----------
echo "${C_YELLOW}[5/5] 演示就绪自检${C_OFF}"
set +e
bun run scripts/demo/check.ts
CHECK_EXIT=$?
set -e

if [ "$CHECK_EXIT" != "0" ]; then
  echo "  ${C_RED}自检未通过，请按上面 FAIL 项修复后重新运行本脚本。${C_OFF}"
  echo ""
  read -k 1 -s "?  按任意键退出..."
  echo ""
  exit 1
fi

sleep 1
open "http://localhost:5173" 2>/dev/null || true

echo "${C_GREEN}${C_BOLD}  准备完毕，可以开始演示${C_OFF}"
echo ""
echo "  ${C_BOLD}建议演示顺序（约 10 分钟）${C_OFF}"
echo "    1. 线索看板  — A/B/C 分级，为什么这家是 A 级（维度明细）"
echo "    2. 内容审核  — 客户画像 → 已生成的 A/B 开发信 → 事实引用徽章"
echo "    3. 真实发信  — 选 Volterra Robotics → 点「批准并发信」→ 当场查收件箱"
echo "    4. 发送看板  — 打开率 / 回复 / 退信 / 域名预热 reputation"
echo "    5. 发送记录  — 每一封的去向与状态（含取消排队）"
echo ""
echo "  ${C_DIM}演示剧本与口播见 DEMO_GUIDE.md；现场救场话术见该文档「排障」一节。${C_OFF}"
echo ""
read -k 1 -s "?  当前窗口仅作提示，可关闭。按任意键关闭..."
echo ""
