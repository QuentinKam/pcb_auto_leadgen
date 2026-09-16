---
name: "deploy-pcb-leadgen"
description: "将本地代码重新部署到阿里云服务器（rsync + build + pm2 restart + 健康检查）。当用户要求「重新部署」「发布到服务器」「更新线上」时调用。"
---

# PCB LeadGen 重新部署

将本地 `apps/*` + `packages/*` 的改动同步到阿里云服务器 `47.251.97.20`，构建 dashboard、重启 8 个 PCB 服务、跑数据库迁移、做健康检查。

## 前置信息

| 项 | 值 |
|---|---|
| 服务器 | `root@47.251.97.20` |
| SSH 密钥 | `/Users/quentingam/Downloads/new_aliyun.pem` |
| 服务器代码目录 | `/opt/pcb-leadgen` |
| 数据库 | `pcb_leadgen_demo`（演示）+ `pcb_leadgen`（生产） |
| DB 密码 | `/root/.pcb_pgpw` |
| 8 个 PCB 服务 | `pcb-{demo,prod}-{gateway,collector,scorer,mailer}`（demo 3011/3014/3012/3013，prod 3021/3024/3022/3023） |
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

### 2. 修正 env → 装依赖 → 构建 → 修复属主（服务器）

> ⚠️ `VITE_TENANT_ID` 是**构建时**注入 bundle 的，必须在 build **之前** sed 好；
> 本地 `apps/dashboard/.env` 是开发租户 `d7ac80b9-…`，rsync 会带上去，若直接构建，
> 线上看板会带错误租户头 → 采集正常但线索列表为空（2026-09-16 踩过）。

```bash
ssh -i /Users/quentingam/Downloads/new_aliyun.pem -o StrictHostKeyChecking=accept-new root@47.251.97.20 '
  set -e
  cd /opt/pcb-leadgen
  # rsync 会覆盖 .env，先把服务器特有的值改回来（必须在 build 之前）
  sed -i "s#^VITE_TENANT_ID=.*#VITE_TENANT_ID=00000000-0000-0000-0000-000000000000#" apps/dashboard/.env
  sed -i "s#^FACTS_JSON_PATH=.*#FACTS_JSON_PATH=/opt/pcb-leadgen/facts/facts.json#" apps/scorer/.env
  pnpm install --registry=https://registry.npmmirror.com
  pnpm --filter @pcb/dashboard build
  chown -R root:root /opt/pcb-leadgen
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
  # 用 start 而非 restart：restart --update-env 不重读 ecosystem 文件里的 env，start 才会
  pm2 start ecosystem.config.cjs --update-env
  nginx -t && nginx -s reload
  pm2 save
'
```

### 5. 健康检查

```bash
ssh ... root@47.251.97.20 '
  for p in 3011 3014 3012 3013 3021 3024 3022 3023; do
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
  pm2 delete pcb-demo-gateway pcb-demo-collector pcb-demo-scorer pcb-demo-mailer \
             pcb-prod-gateway pcb-prod-collector pcb-prod-scorer pcb-prod-mailer
  # 2. 查占端口的旧进程并 kill
  ss -tlnp | grep -E ":301[1-4]|:302[1-4]"
  kill -9 <pid> <pid> ...
  # 3. 重新拉起
  cd /opt/pcb-leadgen
  pm2 start ecosystem.config.cjs
  pm2 save
'
```

⚠️ 只 kill 端口 3011-3014 / 3021-3024 的进程，**不要碰 bps / nextjs / protein 等其他应用**。

线上运行时报错（502 / OOM / 进程崩溃）的排查用 troubleshoot-pcb-server skill。

### column does not exist — schema 漂移

代码 schema 新增了列但数据库没迁移。**不要手动 ALTER TABLE**，回到步骤 3 跑 `drizzle-kit migrate`。

若迁移文件还没生成（`packages/db/drizzle/` 为空），先在本机 `pnpm --filter @pcb/db generate`，提交后再部署。

### apps/*/.env 被覆盖

`rsync` 会同步 `.env` 文件。服务器特有的改动会被覆盖，步骤 2 已含 `sed` 修正，**顺序必须在 build 之前**：
- `apps/dashboard/.env` 的 `VITE_TENANT_ID` 改回 `00000000-…`（构建时注入；错了会导致看板查不到任何数据，但 collector 落库不受影响，现象极具迷惑性）
- `apps/scorer/.env` 的 `FACTS_JSON_PATH` 改回 `/opt/pcb-leadgen/facts/facts.json`

新增服务器特有 env 时要同步更新步骤 2 的修正命令。

### 采集成功但线索列表为空 — 租户错配

- collector 落库只用自己 PM2 注入的 `TENANT_ID=00000000-…`，**忽略** gateway 转发的 `X-Tenant-Id`
- 看板的租户来自构建时的 `VITE_TENANT_ID`。bundle 里 grep 到 `d7ac80b9-…` 即构建错了
- 验证：`grep -rhoE "[0-9a-f]{8}-[0-9a-f-]{27}" apps/dashboard/dist/assets/ | sort -u`
- 修复：sed 改 `apps/dashboard/.env` 后重新 `pnpm --filter @pcb/dashboard build`，用户端需强刷（index.html 可能被浏览器缓存）

### 改了 ecosystem.config.cjs 的 env 不生效

`pm2 restart <名字> --update-env` 不会重读 ecosystem 文件（注入的是当前 shell 环境）。
必须按文件重载：`pm2 start ecosystem.config.cjs --only <名字> --update-env`，再 `pm2 env <id> | grep <变量>` 验证，最后 `pm2 save`。

### pm2 update 后应用全掉线

`pm2 update` 会重启 daemon 但**不自动恢复进程表**。处置：`pm2 resurrect`（从 `/root/.pm2/dump.pm2` 拉起），再 `pm2 save`。整个过程约 1 分钟服务中断，生产机慎用。

## 验收标准

- 8 个 PCB 服务 `/health` 全 200
- 8090 公网返回 200
- 8091 公网返回 401（basic auth）
- 新 bundle 中只含租户 `00000000-…`（grep dist/assets 无 `d7ac80b9`）
- `/api/lead-scores`、`/api/mails/stats` 带 `X-Tenant-Id: 00000000-…` 正常返回数据，无 500
- bps / nextjs / protein 等其他应用保持 online
