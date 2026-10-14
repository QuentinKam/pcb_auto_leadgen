#!/usr/bin/env bash
# 服务器端自动部署脚本 —— 由 GitHub Actions 通过 SSH 调用，也可在服务器上手动执行
# 事实源：GitHub main 分支。reset --hard 会丢弃服务器上对已跟踪文件的改动，
# 未跟踪文件（ecosystem.config.cjs / facts/ / apps/*/.env / node_modules / dist）不受影响。
set -euo pipefail

REPO_DIR=/opt/pcb-leadgen
REPO_URL=https://github.com/QuentinKam/pcb_auto_leadgen.git
BRANCH=main
HEALTH_PORTS=(3011 3012 3013 3021 3022 3023)
PUBLIC_PROBE=http://47.251.97.20:8090/

cd "$REPO_DIR"

# 1. 确保目录是指向 origin 的 git 仓库（首次运行一次性初始化）
if [ ! -d .git ]; then
  echo '[deploy] 首次运行：初始化 git 仓库'
  git init -b "$BRANCH"
fi
git remote add origin "$REPO_URL" 2>/dev/null || git remote set-url origin "$REPO_URL"

# 2. 同步代码到 origin/main
echo "[deploy] 同步代码: fetch + reset --hard origin/$BRANCH"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

# 3. 安装依赖（npmmirror 镜像，与 DEPLOY.md 手动流程一致）
echo '[deploy] pnpm install'
pnpm install --registry=https://registry.npmmirror.com

# 4. 构建看板（VITE_TENANT_ID 取自服务器 apps/dashboard/.env，该文件不入库不被覆盖）
echo '[deploy] 构建 dashboard'
pnpm --filter @pcb/dashboard build

# 5. 重启微服务 + nginx + 持久化 PM2 进程表
echo '[deploy] pm2 restart + nginx reload + pm2 save'
pm2 restart ecosystem.config.cjs --update-env
nginx -t && nginx -s reload
pm2 save

# 6. 健康检查（fail-closed：任一检查不通过则整体退出非 0，CI 标记失败）
echo '[deploy] 健康检查'
failed=0
check_http() {
  local url=$1 expect=$2 code i
  for i in 1 2 3 4 5; do
    code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$url" || echo 000)
    [ "$code" = "$expect" ] && return 0
    sleep 2
  done
  echo "[deploy]   FAIL $url -> $code (期望 $expect)"
  return 1
}
for port in "${HEALTH_PORTS[@]}"; do
  if check_http "http://127.0.0.1:$port/health" 200; then
    echo "[deploy]   ok :$port"
  else
    failed=1
  fi
done
if check_http "$PUBLIC_PROBE" 200; then
  echo '[deploy]   ok 公网 8090'
else
  failed=1
fi
if [ "$failed" -ne 0 ]; then
  echo '[deploy] 健康检查未通过，部署标记失败，请 pm2 logs 排查'
  exit 1
fi

echo "[deploy] 完成: $(git rev-parse --short HEAD) $(git log -1 --format=%s)"
