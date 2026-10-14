#!/usr/bin/env bash
# Mac 侧快通道：把本机 ContentForge 事实登记册直接推到服务器 scorer
#
# 套件数据流（详见 AGENTS.md §12）：
#   pcb_knowledge_base/（知识源）
#     → contentforge ingest pcb
#     → aigc_base_knowledge/contentforge/workspaces/pcb/registry/facts.json
#     → 本脚本 → 服务器同路径登记册（scorer 的 FACTS_JSON_PATH 直接读它）
#
# 定位：快速试验通道。正式更新走服务器自治流程——
#   push pcb_knowledge_base → SSH 跑 /opt/aigc_base_knowledge/regenerate-facts.sh
# 本脚本覆盖的是服务器登记册（已设 skip-worktree），不会与 git pull 冲突。
set -euo pipefail

FACTS_SRC=${FACTS_SRC:-/Users/quentingam/Documents/Projects/products/PCB_ALL/aigc_base_knowledge/contentforge/workspaces/pcb/registry/facts.json}
SSH_KEY=${SSH_KEY:-$HOME/.ssh/new_aliyun.pem}
SERVER=${SERVER:-root@47.251.97.20}
REMOTE_DIR=/opt/aigc_base_knowledge/contentforge/workspaces/pcb/registry

[ -f "$FACTS_SRC" ] || { echo "源文件不存在: $FACTS_SRC"; exit 1; }

echo "==> 上传 facts.json 到 $SERVER:$REMOTE_DIR"
ssh -i "$SSH_KEY" -o BatchMode=yes "$SERVER" "mkdir -p $REMOTE_DIR"
scp -i "$SSH_KEY" -o BatchMode=yes "$FACTS_SRC" "$SERVER:$REMOTE_DIR/facts.json"

echo "==> MD5 校验"
LOCAL_MD5=$(md5 -q "$FACTS_SRC" 2>/dev/null || md5sum "$FACTS_SRC" | cut -d' ' -f1)
REMOTE_MD5=$(ssh -i "$SSH_KEY" -o BatchMode=yes "$SERVER" "md5sum $REMOTE_DIR/facts.json | cut -d' ' -f1")
if [ "$LOCAL_MD5" != "$REMOTE_MD5" ]; then
  echo "MD5 不一致: 本地 $LOCAL_MD5 / 服务器 $REMOTE_MD5"
  exit 1
fi
echo "    ok ($REMOTE_MD5)"

echo "==> 重启 scorer 并通过真实代码路径验证加载"
ssh -i "$SSH_KEY" -o BatchMode=yes "$SERVER" 'bash -s' <<'REMOTE'
set -e
pm2 restart pcb-demo-scorer pcb-prod-scorer --update-env >/dev/null 2>&1
cd /opt/pcb-leadgen/apps/scorer
FACTS_JSON_PATH=/opt/pcb-leadgen/facts/facts.json /usr/local/bin/bun -e "
const m = await import('./src/content/facts-loader.ts');
const facts = await m.loadFacts();
console.log('loadFacts:', facts.length, '条');
if (facts.length === 0) { console.error('facts 为空，同步失败'); process.exit(1); }
"
REMOTE

echo "==> 完成"
