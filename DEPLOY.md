# 部署文档 — 阿里云服务器

> 目标机：`47.251.97.20`（阿里云 · Alibaba Cloud Linux 3 · 2 vCPU / 1.8G / 40G）
> 部署形态：宝塔面板 + 原生 PostgreSQL 13 + Redis 6 + PM2，**非 Docker、非 Fly.io**
> 首次部署：2026-09-10

---

## 1. 访问地址

| 环境 | 地址 | 状态 |
|---|---|---|
| **演示环境** | http://47.251.97.20:8090 | ✅ 已放行，公网可访问 |
| **生产环境** | http://47.251.97.20:8091 | 🔐 已部署 + 已加 basic auth + **已放行，公网可访问** |

> 生产环境需要登录：用户名 `pcbadmin`，密码见服务器 `/root/.pcb_basicauth_pass`（详见 §7）。

如需临时绕过公网（或用 SSH 隧道代替直连），可走隧道访问（同样需要 basic auth）：

```bash
ssh -i ~/.ssh/new_aliyun.pem -N -L 8091:127.0.0.1:8091 root@47.251.97.20
# 然后浏览器打开 http://localhost:8091
```

> ⚠️ **应用本身没有任何登录鉴权**（gateway 是 MVP，鉴权尚未实现），目前靠 nginx basic auth 兜底。
> 演示环境（8090）有意保持公开——里面全是演示数据，方便直接把链接发给客户点。
> **生产环境 8091 请勿去掉 basic auth**，除非已经接入了正式的应用层鉴权。

---

## 2. 两套环境的隔离关系

两套实例**完全隔离**：不同数据库、不同 Redis DB、不同服务端口。互不影响。

| | 演示环境 (demo) | 生产环境 (prod) |
|---|---|---|
| 数据库 | `pcb_leadgen_demo` | `pcb_leadgen` |
| Redis DB | `6379/5` | `6379/6` |
| gateway | `127.0.0.1:3011` | `127.0.0.1:3021` |
| scorer | `127.0.0.1:3012` | `127.0.0.1:3022` |
| mailer (HTTP) | `127.0.0.1:3013` | `127.0.0.1:3023` |
| collector (HTTP) | `127.0.0.1:3014` | `127.0.0.1:3024` |
| 对外 nginx | `:8090` | `:8091` |
| 数据 | 12 家公司 / 14 打分 / 12 画像 / 14 草稿 / 79 发送 | 空库（仅 tenant + user） |

### 2.1 gateway 的下游地址必须由 PM2 注入

gateway 代码里的下游默认值是**本机开发端口**（`SCORER_URL=3002` / `MAILER_URL=3003` /
`COLLECTOR_URL=3004`），与服务器端口完全不同。所以每个 gateway 进程都必须在
`ecosystem.config.cjs` 里按环境注入：

| 进程 | 注入变量 |
|---|---|
| `pcb-demo-gateway` | `SCORER_URL=3012`、`MAILER_URL=3013`、`COLLECTOR_URL=3014` |
| `pcb-prod-gateway` | `SCORER_URL=3022`、`MAILER_URL=3023`、`COLLECTOR_URL=3024` |
| `pcb-demo/prod-collector` | `SCORER_URL=3012/3022`（采集完直接回调打分） |

不注入的表现：服务都 `online`、`/health` 也全 200，但看板点「一键采集」报
`Collector unavailable`、画像生成报 `Scorer unavailable`、邮件统计报 `Mailer unavailable`。
collector 自身的 `apps/collector/.env`（含 dev 租户 ID、假库密码、`SCORER_URL=3002`）同理被
PM2 env 覆盖，不需要手改。

数据库账号：`pcb_user` @ `127.0.0.1:5432`，密码存放在服务器 `/root/.pcb_pgpw`（600 权限），未写入本仓库。

**按需求「只起看板+查询」**：两套都**没有**启动 `send-worker` 与 `warmup-worker`。
因此不会真实发信、也不会自动 warmup 消耗发信额度，但代价是：

> ⚠️ 服务器上点「批准并发信」会一直停在 `queued`（没有 worker 消费队列）。
> 要演示真发信，用本机那套（`./demo.command`），或按 §6 在服务器上补起 worker。

---

## 3. 服务器目录与文件

```
/opt/pcb-leadgen/                      代码根目录（git 仓库，CI 自动部署）
├── ecosystem.config.cjs               PM2 配置（600，含数据库密码）
├── facts/facts.json                   scorer 画像事实库（28KB）
├── apps/dashboard/dist/               看板静态产物（nginx 直接托管）
└── apps/{gateway,scorer,mailer}/     以源码方式由 bun 直接运行

/root/.pcb_pgpw                        PostgreSQL 密码
/root/.pm2/dump.pm2                    PM2 进程快照（已 save，开机自启）
/www/server/panel/vhost/nginx/pcb-demo.conf    8090 → 静态 + /api → 3011
/www/server/panel/vhost/nginx/pcb-prod.conf    8091 → 静态 + /api → 3021
```

运行时：`/usr/local/bin/bun` (1.4.2)。本机 Node 仅用于跑 pnpm 装依赖与构建。

### 与服务器上已有业务的关系

这台机器**不是空闲机器**，在跑宝塔面板 + WordPress ×2 + Medusa 商城（`brick_parts_store`）+ 2 个 Next.js
应用（PM2: `bps-backend` / `bps-storefront` / `nextjs_tob_1` / `protein_value`），
以及 MariaDB(3306) / PostgreSQL(5432) / Redis(6379) / php-fpm。

本次部署**全部为增量**，未改动任何既有站点、数据库或 PM2 应用：
- 新建独立数据库 `pcb_leadgen_demo`、`pcb_leadgen`（`brick_parts_store` 未动）
- Redis 用 DB5/DB6（既有应用在 DB0，无冲突）
- 端口 3011-3013 / 3021-3023 / 8090-8091 此前均空闲
- 只新增 nginx vhost 两个文件，`nginx -t` 通过后才 reload

---

## 4. 日常运维

```bash
SSH="ssh -i ~/.ssh/new_aliyun.pem root@47.251.97.20"

# 查看状态
$SSH "pm2 list"

# 看日志
$SSH "pm2 logs pcb-demo-gateway --lines 50"
$SSH "pm2 logs pcb-prod-mailer --lines 50"

# 重启全部 / 单个
$SSH "pm2 restart /opt/pcb-leadgen/ecosystem.config.cjs --update-env"
$SSH "pm2 restart pcb-demo-gateway"

# 健康检查（8 个服务都应返回 200）
$SSH 'for p in 3011 3012 3013 3014 3021 3022 3023 3024; do echo -n ":$p "; curl -s -m 5 http://127.0.0.1:$p/health | head -c 60; echo; done'

# 公网自检
curl -s -o /dev/null -w '%{http_code}\n' http://47.251.97.20:8090/
```

---

## 5. 更新代码后重新部署

### 5.1 自动部署（默认，2026-10-15 起）

`git push origin main` 即触发 GitHub Actions（`.github/workflows/deploy.yml`）：

1. 云端 runner SSH 上服务器，执行 `scripts/deploy-server.sh`
2. `git fetch + reset --hard origin/main`（服务器代码以 GitHub main 为唯一事实源）
3. `pnpm install`（npmmirror 镜像）→ 构建 dashboard → `pm2 restart` → nginx reload
4. 健康检查：8 个内部端口 + 公网 8090 全部 200 才算成功，**任一不过则 CI 报红**

- **纯文档变更不触发部署**（`**.md` / `docs/` / `blog/` / `.github/` 在 paths-ignore 中）
- 也可在 Actions 页面 **Run workflow** 手动触发（workflow_dispatch）
- 服务器首次 git 转换与备份：`/root/pcb-deploy-backups/`（源码包 + ecosystem/.env 专属包）
- 服务器上**不要手改已跟踪文件**——下次部署 `reset --hard` 会丢弃；未跟踪文件
  （`ecosystem.config.cjs`、`facts/`、`apps/*/.env`、`node_modules`、`dist`）不受影响
- 回滚：服务器上 `git reset --hard <旧commit> && pm2 restart ecosystem.config.cjs --update-env`，
  或从 `/root/pcb-deploy-backups/` 解包恢复

所需 GitHub Secrets（已配置）：`SERVER_HOST` / `SERVER_USER` / `SERVER_SSH_KEY`。

### 5.2 手动 rsync 部署（备用，CI 故障时）

> ⚠️ 服务器现已是 git 仓库。rsync 会覆盖已跟踪文件，造成工作区脏乱，
> 下次 CI 部署时被 `reset --hard` 丢弃——仅建议在 CI 不可用时应急使用。

在本机仓库根目录执行：

```bash
cd /Users/quentingam/Documents/pcb_auto_leadgen

rsync -az \
  --exclude node_modules --exclude .git --exclude .turbo --exclude dist \
  --exclude .DS_Store \
  -e "ssh -i ~/.ssh/new_aliyun.pem" \
  ./ root@47.251.97.20:/opt/pcb-leadgen/

ssh -i ~/.ssh/new_aliyun.pem root@47.251.97.20 "
  set -e
  cd /opt/pcb-leadgen
  pnpm install --registry=https://registry.npmmirror.com
  pnpm --filter @pcb/dashboard build
  chown -R root:root /opt/pcb-leadgen
  pm2 restart ecosystem.config.cjs --update-env
  nginx -t && nginx -s reload
  pm2 save
"
```

> ⚠️ `rsync` 保留本机 uid（501），服务器上 501 恰好是 `games` 用户。
> 所以每次同步后**必须 `chown -R root:root`**，否则文件属主会变成系统账号。

**注意**：`apps/*/.env` 会被同步覆盖，服务器上特有的改动（如 `FACTS_JSON_PATH`，见 §8）
需要重新执行 §8 的 `sed`，或改为只在 PM2 里注入。

### 5.3 CI 故障排查

**verify 门禁先于 deploy**（2026-10-16 起）：lint → build → test 全过才允许部署。
门禁自带 PostgreSQL / Redis service container 与显式就绪等待；数据库迁移走
`packages/db/migrate.ts`（drizzle-orm migrator，错误可见），迁移文件在 git 内
（`packages/db/drizzle/`，曾被 `.gitignore` 的 `drizzle/` 规则误伤整个排除）。

**`pnpm install` 被 kill（exit 137 / SIGKILL）= 服务器 OOM**：
2026-10-16 实测过一次——安装进行到下载 playwright-core 时进程被杀，
是服务器内存压力的瞬时现象，代码与门禁均无问题。恢复方式：
Actions 页面对该 run **Re-run failed jobs**（只重跑 deploy，不重跑门禁）。
若反复 OOM，先 `free -m` 看内存，考虑错峰部署或给服务器加内存。

---

## 6. 补齐 worker（真发信 / 自动 warmup）

按需执行，注意**用哪套环境就连对应数据库与 Redis**：

```bash
ssh -i ~/.ssh/new_aliyun.pem root@47.251.97.20

# —— 演示环境：send-worker（让「批准并发信」能真发）——
cd /opt/pcb-leadgen/apps/mailer
export PORT=3013 \
       DATABASE_URL="postgresql://pcb_user:$(cat /root/.pcb_pgpw)@127.0.0.1:5432/pcb_leadgen_demo" \
       REDIS_URL="redis://127.0.0.1:6379/5" \
       TENANT_ID=00000000-0000-0000-0000-000000000000
pm2 start /usr/local/bin/bun --name pcb-demo-send-worker \
  --interpreter none -- run src/workers/send-worker.ts
pm2 save

# —— warmup worker（会自动真实发信，慎开）——
# pm2 start /usr/local/bin/bun --name pcb-demo-warmup-worker \
#   --interpreter none -- run src/workers/warmup-worker.ts

# 关掉
pm2 delete pcb-demo-send-worker
```

真发信前确认 `apps/mailer/.env` 的 `DEMO_RECIPIENT_EMAIL` 是**你自己能当场打开的邮箱**——
演示数据里所有联系人邮箱都是它的 `+公司标识` 别名，误点也只会进你自己的收件箱。

---

## 7. 生产环境 basic auth（已配置 ✅ 2026-09-10）

看板**没有应用层鉴权**，所以生产环境在 nginx 层加了 HTTP Basic Auth（仅 8091；8090 演示环境有意保持公开）。

| 项 | 值 |
|---|---|
| 用户名 | `pcbadmin` |
| 密码 | 见服务器 `/root/.pcb_basicauth_pass`（600 权限，未入仓库） |
| 密码文件 | `/etc/nginx/pcb-prod.htpasswd`（`root:www`，640） |

> ⚠️ **密码文件必须放在 `www` 用户可读的路径**。宝塔把 `/www/server/panel/vhost/nginx/`
> 设成 `drw------- root root`，nginx worker（www 身份）**无法穿越进去读文件**——表现是
> 「不带凭据返回 401 正常，带上正确凭据反而返回 500」。所以放在了 `/etc/nginx/`。

改密码 / 加用户：

```bash
ssh -i ~/.ssh/new_aliyun.pem root@47.251.97.20

# 改密码（-b 直接把密码写命令行；会覆盖同名用户）
htpasswd -b /etc/nginx/pcb-prod.htpasswd pcbadmin '新密码'
chown root:www /etc/nginx/pcb-prod.htpasswd && chmod 640 /etc/nginx/pcb-prod.htpasswd

# 新增用户（不加 -c，避免清空已有用户）
htpasswd -b /etc/nginx/pcb-prod.htpasswd 另一个用户名 '密码'
```

**关掉 basic auth**（例如之后要接正式登录鉴权）：把 `pcb-prod.conf` 里 `auth_basic` 与
`auth_basic_user_file` 两行注释掉，`nginx -t && nginx -s reload`。

**验证**：

```bash
curl -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8091/          # 期望 401
curl -u pcbadmin:$(cat /root/.pcb_basicauth_pass) -o /dev/null \
     -w '%{http_code}\n' http://127.0.0.1:8091/                        # 期望 200
```

---

## 8. 重置 / 重灌演示数据

```bash
ssh -i ~/.ssh/new_aliyun.pem root@47.251.97.20 "
  cd /opt/pcb-leadgen
  export DATABASE_URL='postgresql://pcb_user:'\$(cat /root/.pcb_pgpw)'@127.0.0.1:5432/pcb_leadgen_demo'
  bun run scripts/demo/seed.ts --reset   # 只清演示数据
  bun run scripts/demo/seed.ts           # 重新写入
"
```

`--reset` 只删 `companies.raw_payload->>'demo'='true'` 的行与 `[DEMO]` 前缀活动，不会误伤真实数据。
**生产库不要执行 seed。**

`FACTS_JSON_PATH` 若被同步覆盖，修正：

```bash
sed -i 's#^FACTS_JSON_PATH=.*#FACTS_JSON_PATH=/opt/pcb-leadgen/facts/facts.json#' \
  /opt/pcb-leadgen/apps/scorer/.env
```

---

## 9. 排错备忘（本次部署踩到的坑）

| 现象 | 原因 | 处理 |
|---|---|---|
| PM2 显示 service `online`、日志也打了 `Gateway listening on ...`，但端口**根本没监听**，curl 拒绝连接 | PM2 的 bun interpreter 走 `ProcessContainerForkBun.js` 去 **import** 目标模块；而本项目服务用 Bun 的 `export default { port, fetch }`，这**只在作为入口文件运行时**才真正监听。被 import 时模块顶层代码照跑（所以日志正常），HTTP server 不启动——**静默失败** | ecosystem 里改成 `script: '/usr/local/bin/bun'` + `args: 'run src/index.ts'` + `interpreter: 'none'`，即直接 `bun run` 当入口跑 |
| 全新数据库上 `seed.ts` 报 `audit_logs_user_id_fk` 违约 | `audit_logs.user_id` 有指向 `users` 的外键，而 seed 只建了 tenant 没建 user；本机开发时这行早就存在，所以一直没暴露 | 已在 `scripts/demo/seed.ts` 补 `ensureUser()` |
| 8090 返回 `PROBE_OK` 而不是看板 | 之前的端口探测进程还占着 8090，nginx 抢不到端口（`nginx -t` 仍会通过，reload 也不报错） | `pkill -f PROBE_OK` 后 `nginx -s reload`；用 `ss -tlnp \| grep :8090` 确认属主是 nginx |
| basic auth **不带凭据 401 正常，带正确凭据却 500** | htpasswd 文件放在了 `/www/server/panel/vhost/nginx/`，而宝塔把该目录设成 `drw------- root root`，nginx worker（www 身份）无法穿越读取；401 阶段还没读文件所以正常，真正校验时才失败 | 把 htpasswd 挪到 `/etc/nginx/`（755 路径）并 `chown root:www` + `chmod 640`；用 `sudo -u www test -r <file>` 验证可读性 |
| 看板四个 Tab 全空但不报错 | `VITE_TENANT_ID` 与库里数据租户不一致 | 两边都必须是 `00000000-0000-0000-0000-000000000000` |
| 服务全部 `online`、`/health` 全 200，但看板报 `Collector/SCORER/Mailer unavailable`、画像生成失败 | gateway 用的是代码里的**开发默认端口**（3002/3003/3004），服务器实际端口不是这些；collector 甚至根本没有起进程 | 在 `ecosystem.config.cjs` 给每个 gateway 注入对应环境的 `SCORER_URL`/`MAILER_URL`/`COLLECTOR_URL`，并补起 `pcb-demo-collector`(3014) / `pcb-prod-collector`(3024)（见 §2.1） |
| 文件属主变成 `games` | rsync 保留本机 uid 501 | `chown -R root:root /opt/pcb-leadgen` |

---

## 10. 安全组放行记录

阿里云控制台 → 安全组 → 入方向。本次部署前服务器**只放行了极少数端口**
（22 / 8083 / 8084 / 8188 / 8288 / 8388 / 8888），80、443 以及 3001-3003 等**全部被过滤**。

| 端口 | 用途 | 状态 |
|---|---|---|
| 8090 | 演示环境 | ✅ 已放行 |
| 8091 | 生产环境（basic auth 已就绪） | ✅ 已放行（2026-09-11 外部探测返回 401，确认公网可达） |

> 该机器没有域名解析过来（`rakuto.store` 指向 Namecheap 停放页，`www` 指向 Vercel），
> 因此只能用 `IP:端口` 访问；若要用域名 + HTTPS，需要额外做解析与 ICP 备案。

---

## 11. PM2 日志轮转（已配置 ✅ 2026-09-11）

此前 PM2 日志无轮转，长期运行会撑爆磁盘。已装 `pm2-logrotate` 模块（v3.0.0）并设置保留策略：

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M     # 单文件超 10M 即切分
pm2 set pm2-logrotate:retain 7         # 每类日志保留 7 份（压缩后）
pm2 set pm2-logrotate:compress true    # 切分后 gzip 压缩
pm2 save                               # 持久化模块，重启后仍在
```

| 项 | 值 |
|---|---|
| 模块 | `pm2-logrotate` 3.0.0 |
| 单文件上限 | 10M |
| 保留份数 | 7 |
| 切分时机 | 每日 0 点（`rotateInterval: 0 0 * * *`）+ 超 10M 时 |
| 日志目录 | `/root/.pm2/logs` |

> 注：`pm2 list` 曾提示内存版与本地版不一致（7.0.1 vs 7.0.4）。2026-09-11 已执行 `pm2 update`，
> 版本已对齐为 **7.0.4**。
>
> ⚠️ **实测坑**：`pm2 update` 会 kill 旧 daemon 并起一个新 daemon，**但不会自动恢复进程表**——
> 执行后 `pm2 list` 只剩 logrotate 模块，**全部应用掉线**。必须立刻 `pm2 resurrect` 从
> `/root/.pm2/dump.pm2` 拉起，再 `pm2 save`。整个过程约有 1 分钟服务中断，
> 生产机执行前请留维护窗口。
