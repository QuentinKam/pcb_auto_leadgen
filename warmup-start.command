#!/bin/zsh
# PCB 获客 Agent — 优先级 B：域名 warmup 一键启动脚本（macOS 专用）
# 前置依赖：start.command 已运行（gateway :3001 + mailer :3003 HTTP + send-worker 已启动）
# 本脚本额外启动 warmup-worker，并提供手动 trigger 选项

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

echo "\033[1;35m====== PCB Auto LeadGen — 域名 Warmup 启动 ======\033[0m"
echo "项目根目录: $PROJECT_ROOT"
echo ""

# ---- 1. 读取 mailer/.env 校验关键 warmup 配置 ----
echo "\033[1;33m[1/4] 配置检查 (apps/mailer/.env)...\033[0m"
ENV_FILE="$PROJECT_ROOT/apps/mailer/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "  ❌ 找不到 $ENV_FILE，请先从 .env.example 复制并填写"
  exit 1
fi

get_env() {
  grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'"
}

RESEND_KEY=$(get_env "RESEND_API_KEY")
SENDING_DOMAIN=$(get_env "DEFAULT_SENDING_DOMAIN")
FROM_ADDRS=$(get_env "DEFAULT_FROM_ADDRESSES")
SEED_EMAILS=$(get_env "WARMUP_SEED_EMAILS")
WARMUP_ENABLED=$(get_env "WARMUP_ENABLED")

ISSUE=0

# Resend Key
if [ -z "$RESEND_KEY" ] || [[ "$RESEND_KEY" == re_*placeholder* ]] || [[ "$RESEND_KEY" == "your_"* ]]; then
  echo "  ⚠️  RESEND_API_KEY 未填真实值，将走 mock 模式（不会真实发信）"
else
  echo "  ✅ RESEND_API_KEY = ${RESEND_KEY:0:6}*** 已填"
fi

# Sending domain
if [ -z "$SENDING_DOMAIN" ] || [ "$SENDING_DOMAIN" = "your-domain.com" ]; then
  echo "  ❌ DEFAULT_SENDING_DOMAIN 未填（当前: '$SENDING_DOMAIN'）"
  ISSUE=1
else
  echo "  ✅ DEFAULT_SENDING_DOMAIN = $SENDING_DOMAIN"
fi

# From addresses
if [ -z "$FROM_ADDRS" ]; then
  echo "  ❌ DEFAULT_FROM_ADDRESSES 未填"
  ISSUE=1
else
  COUNT=$(echo "$FROM_ADDRS" | tr ',' '\n' | grep -c '@' || true)
  echo "  ✅ DEFAULT_FROM_ADDRESSES = $COUNT 个发件邮箱"
fi

# Seed emails
SEED_COUNT=0
if [ -n "$SEED_EMAILS" ] && [ "$SEED_EMAILS" != "[]" ]; then
  SEED_COUNT=$(echo "$SEED_EMAILS" | grep -oE '[^"@,\[\] ]+@[^"@,\[\] ]+\.[^"@,\[\] ]+' | wc -l | tr -d ' ')
fi
if [ "$SEED_COUNT" -lt 10 ]; then
  echo "  ⚠️  WARMUP_SEED_EMAILS 只有 $SEED_COUNT 个（建议 50-100+ 自有收件箱，当前走 mock 测试可先填 10 个自有邮箱/Mailtrap）"
  echo "       格式: WARMUP_SEED_EMAILS=[\"a@x.com\",\"b@x.com\"]"
else
  echo "  ✅ WARMUP_SEED_EMAILS = $SEED_COUNT 个种子邮箱"
fi

# Warmup enabled
if [ "$WARMUP_ENABLED" = "false" ]; then
  echo "  ⚠️  WARMUP_ENABLED=false，手动 trigger 仍可发，但每日 cron 自动任务不会跑"
else
  echo "  ✅ WARMUP_ENABLED=true"
fi

if [ "$ISSUE" -eq 1 ]; then
  echo ""
  echo "  ❌ 存在必须修复的配置项，已暂停。请先修改 apps/mailer/.env 后重新运行。"
  read -k 1 -s "?按任意键退出..."
  exit 1
fi

echo ""

# ---- 2. 检查 mailer 服务是否已在 3003 监听 ----
echo "\033[1;33m[2/4] 检查 Mailer HTTP 服务 (:3003)...\033[0m"
MAILER_OK=0
for i in {1..10}; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3003/health" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    echo "  ✅ Mailer :3003 /health 返回 200"
    MAILER_OK=1
    break
  fi
  echo "  ...等待 Mailer 启动 ($i/10)，HTTP=$HTTP_CODE"
  sleep 2
done
if [ "$MAILER_OK" -eq 0 ]; then
  echo "  ❌ Mailer :3003 未就绪，请先在另一个终端运行 ./start.command 启动所有服务"
  read -k 1 -s "?按任意键退出..."
  exit 1
fi

echo ""

# ---- 3. 新开 Terminal Tab 启动 warmup-worker ----
echo "\033[1;33m[3/4] 启动 warmup-worker (BullMQ Worker)...\033[0m"
osascript -e '
  tell application "Terminal"
    activate
    tell application "System Events" to keystroke "t" using command down
    delay 0.3
    do script "cd '"'$PROJECT_ROOT'"' && clear && echo '\''\033[1;35m===== Mailer warmup-worker =====\033[0m'\'' && pnpm --filter @pcb/mailer warmup" in front window
  end tell
' >/dev/null 2>&1 || true

sleep 2

# ---- 4. 查询 warmup status ----
echo ""
echo "\033[1;33m[4/4] 查询 /warmup/status ...\033[0m"
TENANT_ID=$(get_env "TENANT_ID" || echo "00000000-0000-0000-0000-000000000000")
STATUS_JSON=$(curl -s -H "X-Tenant-Id: $TENANT_ID" "http://localhost:3003/warmup/status" 2>/dev/null || echo "{}")
if command -v jq >/dev/null 2>&1; then
  echo "$STATUS_JSON" | jq .
else
  echo "$STATUS_JSON"
fi

echo ""
echo "\033[1;32m====== Warmup 启动完成 ======\033[0m"
echo "  📅 每日 cron: $(get_env WARMUP_DAILY_CRON) (UTC, 默认 = 国内 10:00)"
echo "  🚀 立即手动触发: "
echo "     curl -s -X POST http://localhost:3003/warmup/trigger \\"
echo "       -H 'X-Tenant-Id: $TENANT_ID' -H 'Content-Type: application/json' \\"
echo "       -d '{\"countOverride\": 5}'"
echo ""
echo "  📊 查看 warmup 14 天计划: curl http://localhost:3003/warmup/plan -H 'X-Tenant-Id: $TENANT_ID' | jq"
echo "  📋 查看最近 warmup 发送:  curl http://localhost:3003/warmup/recent -H 'X-Tenant-Id: $TENANT_ID' | jq"
echo ""
echo "  🩺 完整健康检查: ./scripts/health-check.sh"
echo ""
read -k 1 -s "?warmup-worker 在新开 Tab 运行。当前窗口按任意键关闭..."
