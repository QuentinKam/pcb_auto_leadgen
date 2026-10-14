#!/usr/bin/env bash
# 同步 facts.json：ContentForge 事实登记册 → pcb_auto_leadgen 服务器
#
# 套件数据流：
#   pcb_knowledge_base/（知识源 markdown）
#     → contentforge ingest pcb（在 aigc_base_knowledge/contentforge 跑）
#     → aigc_base_knowledge/contentforge/workspaces/pcb/registry/facts.json
#     → 本脚本 → 服务器 /opt/pcb-leadgen/facts/facts.json（scorer 消费）
#
# 知识库内容有更新时，先在 contentforge 重新 ingest 生成 facts.json，
# 再跑本脚本：上传 → MD5 校验 → 重启 demo/prod scorer → 真实代码路径验证加载。
set -euo pipefail

FACTS_SRC=${FACTS_SRC:-/Users/quentingam/Documents/Projects/products/PCB_ALL/aigc_base_knowledge/contentforge/workspaces/pcb/registry/facts.json}
SSH_KEY=${SSH_KEY:-$HOME/.ssh/new_aliyun.pem}
SERVER=${SERVER:-root@47.251.97.20}
REMOTE_DIR=/opt/pcb-leadgen/facts

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
