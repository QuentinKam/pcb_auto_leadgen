#!/bin/zsh
# PCB 获客 Agent — 服务健康检查脚本
# 用法: ./scripts/health-check.sh
# 依次检查 PG/Redis/gateway:3001/scorer:3002/mailer:3003 + /warmup/status + Dashboard :5173

set -u

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

GREEN="\033[1;32m"
RED="\033[1;31m"
YELLOW="\033[1;33m"
CYAN="\033[1;36m"
RESET="\033[0m"
PASS="${GREEN}✅${RESET}"
FAIL="${RED}❌${RESET}"
WARN="${YELLOW}⚠️${RESET}"

OK=0
TOTAL=0

_check() {
  local label="$1"
  local cmd="$2"
  TOTAL=$((TOTAL+1))
  local out
  if out=$(eval "$cmd" 2>&1); then
    echo "  $PASS $label"
    [ -n "$out" ] && echo "       $out"
  else
    echo "  $FAIL $label"
    [ -n "$out" ] && echo "       $out"
    OK=1
  fi
}

echo "${CYAN}====== PCB Auto LeadGen — 健康检查 ======${RESET}"
echo "项目根: $PROJECT_ROOT"
echo ""

# ---------- 基础依赖 ----------
echo "${CYAN}[基础设施]${RESET}"
_check "PostgreSQL 5432" 'out=$(pg_isready -h localhost -p 5432 2>&1) && (echo "$out" | grep -qE "accepting connections|接受连接") && echo "$out"'
_check "Redis 6379" '[ "$(redis-cli -h localhost -p 6379 ping 2>&1)" = "PONG" ] && echo "redis-cli ping = PONG"'
_check "pnpm 可用" 'pnpm -v >/dev/null && echo "pnpm $(pnpm -v)"'
_check "bun 可用" 'bun -v >/dev/null && echo "bun $(bun -v)"'

echo ""
echo "${CYAN}[服务 HTTP 健康 (:3001/:3002/:3003/:5173)]${RESET}"

_check_http() {
  local name="$1"
  local url="$2"
  local desc="$3"
  TOTAL=$((TOTAL+1))
  local resp
  resp=$(curl -s -o /tmp/pcb_hc_body -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")
  if [ "$resp" = "200" ]; then
    local body
    body=$(cat /tmp/pcb_hc_body 2>/dev/null | head -c 200)
    echo "  $PASS $name ($url) → HTTP $resp"
    [ -n "$desc" ] && echo "       返回摘要: $body"
  else
    echo "  $FAIL $name ($url) → HTTP $resp"
    OK=1
  fi
}

_check_http "Gateway" "http://localhost:3001/api/tenants" "列租户（可能空数组但 200=OK）"
_check_http "Scorer /health" "http://localhost:3002/health" "Scorer 健康"
_check_http "Mailer /health" "http://localhost:3003/health" "Mailer 健康（含 resend/quota/warmup 字段）"
_check_http "Dashboard" "http://localhost:5173" "Vite 首页（HTTP 200=OK）"

echo ""
echo "${CYAN}[Mailer 深度检查（通过 Gateway /api/mails 代理）]${RESET}"

TENANT_ID="00000000-0000-0000-0000-000000000000"
if [ -f "$PROJECT_ROOT/apps/mailer/.env" ]; then
  TID=$(grep -E "^TENANT_ID=" "$PROJECT_ROOT/apps/mailer/.env" | tail -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'")
  [ -n "$TID" ] && TENANT_ID="$TID"
fi

TOTAL=$((TOTAL+1))
WARMUP_JSON=$(curl -s --max-time 5 -H "X-Tenant-Id: $TENANT_ID" "http://localhost:3003/warmup/status" 2>/dev/null || echo "{}")
if [ -n "$WARMUP_JSON" ] && [ "$WARMUP_JSON" != "{}" ] && [ "$WARMUP_JSON" != "null" ]; then
  echo "  $PASS /warmup/status 返回非空 JSON"
  if command -v jq >/dev/null 2>&1; then
    REPUTATION=$(echo "$WARMUP_JSON" | jq -r '.reputationScore // "N/A"' 2>/dev/null)
    TODAY_TARGET=$(echo "$WARMUP_JSON" | jq -r '.todaysEntry // "N/A"' 2>/dev/null)
    TODAY_SENT=$(echo "$WARMUP_JSON" | jq -r '.todaySent // "N/A"' 2>/dev/null)
    SEED_POOL=$(echo "$WARMUP_JSON" | jq -r '.seedPoolSize // "N/A"' 2>/dev/null)
    REPUTATION_NUM=$(echo "$REPUTATION" | grep -E '^[0-9]+$' || echo "")
    if [ -n "$REPUTATION_NUM" ]; then
      if [ "$REPUTATION_NUM" -ge 85 ]; then
        REP_COLOR="$GREEN"
      elif [ "$REPUTATION_NUM" -ge 60 ]; then
        REP_COLOR="$CYAN"
      elif [ "$REPUTATION_NUM" -ge 30 ]; then
        REP_COLOR="$YELLOW"
      else
        REP_COLOR="$RED"
      fi
      echo "       reputationScore: $REP_COLOR$REPUTATION/100$RESET  (≥85 绿 /60-85 蓝 /30-60 黄 /<30 红)"
    else
      echo "       reputationScore: $REPUTATION"
    fi
    echo "       todaysTarget:    $TODAY_TARGET"
    echo "       todaySent:       $TODAY_SENT"
    echo "       seedPoolSize:    $SEED_POOL"
    SEED_INT=$(echo "$SEED_POOL" | grep -E '^[0-9]+$' || echo 0)
    if [ -n "$SEED_INT" ] && [ "$SEED_INT" -lt 10 ]; then
      echo "       $WARN 种子邮箱 < 10 个，warmup 模拟数据会偏少，建议补到 50-100+"
    fi
  else
    echo "       (安装 jq 可查看详细字段: brew install jq)"
    echo "       原始: $(echo "$WARMUP_JSON" | head -c 200)"
  fi
else
  echo "  $FAIL /warmup/status 返回空 ($WARMUP_JSON)"
  OK=1
fi

echo ""
echo "${CYAN}[总结]${RESET}"
if [ "$OK" -eq 0 ]; then
  echo "  ${GREEN}全部 $TOTAL 项检查通过 ✅${RESET}"
  echo "  建议下一步：浏览器开 http://localhost:5173，按优先级 A 验收路径走 4 个 Tab"
else
  echo "  ${RED}存在失败项，请先修复后再联调${RESET}"
fi
echo ""

exit $OK
