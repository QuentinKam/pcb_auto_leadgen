---
name: "deploy-pcb-leadgen"
description: "将本地代码重新部署到阿里云服务器（rsync + build + pm2 restart + 健康检查）。当用户要求「重新部署」「发布到服务器」「更新线上」时调用。"
---

# PCB LeadGen 重新部署

将本地 `apps/*` + `packages/*` 的改动同步到阿里云服务器 `47.251.97.20`，构建 dashboard、重启 6 个 PCB 服务、跑数据库迁移、做健康检查。

## 前置信息

| 项 | 值 |
|---|---|
| 服务器 | `root@47.251.97.20` |
| SSH 密钥 | `/Users/quentingam/Downloads/new_aliyun.pem` |
| 服务器代码目录 | `/opt/pcb-leadgen` |
| 数据库 | `pcb_leadgen_demo`（演示）+ `pcb_leadgen`（生产） |
| DB 密码 | `/root/.pcb_pgpw` |
| 6 个 PCB 服务 | `pcb-{demo,prod}-{gateway,scorer,mailer}`（端口 3011-3013 / 3021-3023） |
| 对外端口 | 8090（演示，公开）/ 8091（生产，basic auth） |

## 执行步骤

### 1. 同步代码（本机）

```bash
rsync -az \
  --exclude node_modules --exclude .git --exclude .turbo --exclude dist \
  --exclude .DS_Store \
  -e "ssh -i /Users/quentingam/Downloads/new_aliyun.pem -o StrictHostKeyChecking=accept-new" \
  ./ root@47.251.97.20:/opt/pcb-leadgen/
```

### 2. 装依赖 + 构建 + 修复属主 + 修正 env（服务器）

```bash
ssh -i /Users/quentingam/Downloads/new_aliyun.pem -o StrictHostKeyChecking=accept-new root@47.251.97.20 '
  set -e
  cd /opt/pcb-leadgen
  pnpm install --registry=https://registry.npmmirror.com
  pnpm --filter @pcb/dashboard build
  chown -R root:root /opt/pcb-leadgen
  # rsync 会覆盖 .env，把 FACTS_JSON_PATH 改回服务器路径
  sed -i "s#^FACTS_JSON_PATH=.*#FACTS_JSON_PATH=/opt/pcb-leadgen/facts/facts.json#" apps/scorer/.env
'
```

### 3. 跑数据库迁移（服务器，两套库）

> AGENTS.md §10 强制规则：schema 改动必须走 `drizzle-kit migrate`，**禁止手动 ALTER TABLE**。

```bash
ssh ... root@47.251.97.20 '
  cd /opt/pcb-leadgen
  PASS=$(cat /root/.pcb_pgpw)
  # demo 库
  DATABASE_URL="postgresql://pcb_user:$PASS@127.0.0.1:5432/pcb_leadgen_demo" \
    pnpm --filter @pcb/db migrate
  # prod 库
  DATABASE_URL="postgresql://pcb_user:$PASS@127.0.0.1:5432/pcb_leadgen" \
    pnpm --filter @pcb/db migrate
'
```

### 4. 重启服务（服务器）

```bash
ssh ... root@47.251.97.20 '
  cd /opt/pcb-leadgen
  pm2 restart ecosystem.config.cjs --update-env
  nginx -t && nginx -s reload
  pm2 save
'
```

### 5. 健康检查

```bash
ssh ... root@47.251.97.20 '
  for p in 3011 3012 3013 3021 3022 3023; do
    printf "%s -> " $p
    curl -s -m 5 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:$p/health
  done
'
# 公网探测
curl -s -o /dev/null -w "8090=%{http_code}\n" http://47.251.97.20:8090/
curl -s -o /dev/null -w "8091=%{http_code}\n" http://47.251.97.20:8091/
```

## 常见故障与处置

### EADDRINUSE — 端口被旧进程占用

`pm2 restart` 后新进程起不来，报 `Failed to start server. Is port 3011 in use?`。原因是旧进程还占着端口（多见于 `pm2 update` 后进程表脱节）。

处置：

```bash
ssh ... root@47.251.97.20 '
  # 1. 从 PM2 删除 errored 的进程
  pm2 delete pcb-demo-gateway pcb-demo-scorer pcb-demo-mailer \
             pcb-prod-gateway pcb-prod-scorer pcb-prod-mailer
  # 2. 查占端口的旧进程并 kill
  ss -tlnp | grep -E ":301[123]|:302[123]"
  kill -9 <pid> <pid> ...
  # 3. 重新拉起
  cd /opt/pcb-leadgen
  pm2 start ecosystem.config.cjs
  pm2 save
'
```

⚠️ 只 kill 端口 3011-3013 / 3021-3023 的进程，**不要碰 bps / nextjs / protein 等其他应用**。

### column does not exist — schema 漂移

代码 schema 新增了列但数据库没迁移。**不要手动 ALTER TABLE**，回到步骤 3 跑 `drizzle-kit migrate`。

若迁移文件还没生成（`packages/db/drizzle/` 为空），先在本机 `pnpm --filter @pcb/db generate`，提交后再部署。

### apps/*/.env 被覆盖

`rsync` 会同步 `.env` 文件。服务器特有的改动（`FACTS_JSON_PATH` 等）会被覆盖，步骤 2 已含 `sed` 修正。新增服务器特有 env 时要同步更新步骤 2 的修正命令。

### pm2 update 后应用全掉线

`pm2 update` 会重启 daemon 但**不自动恢复进程表**。处置：`pm2 resurrect`（从 `/root/.pm2/dump.pm2` 拉起），再 `pm2 save`。整个过程约 1 分钟服务中断，生产机慎用。

## 验收标准

- 6 个 PCB 服务 `/health` 全 200
- 8090 公网返回 200
- 8091 公网返回 401（basic auth）
- `/api/lead-scores`、`/api/mails/stats` 正常返回数据，无 500
- bps / nextjs / protein 等其他应用保持 online
