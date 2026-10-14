# 项目长期记忆 — pcb_auto_leadgen

## 部署（阿里云 47.251.97.20，宝塔 + 原生 PG13 + Redis6 + PM2，非 Docker）
- 形态：演示(8090 公开) / 生产(8091 basic auth，用户 pcbadmin，密码在 /root/.pcb_basicauth_pass)。详见仓库 DEPLOY.md。
- `ecosystem.config.cjs` 是**服务器专属、不入仓库**的文件（含真实 PG 密码，600 权限）。服务器上若丢失，必须按 DEPLOY.md §2/§9 重建 6 进程并注入：DATABASE_URL（真实密码读 /root/.pcb_pgpw）、REDIS_URL（demo /5、prod /6）、TENANT_ID=00000000-0000-0000-0000-000000000000、PORT、scorer 的 FACTS_JSON_PATH。本地 apps/*/.env 的 DATABASE_URL 是假密码 `dev_only_local`，靠 PM2 env 覆盖。
- **dashboard 构建**：VITE_TENANT_ID 构建时写死。服务器 apps/dashboard/.env 是 `00000000-...`（不入库、CI 不会覆盖）；本地那份是 dev tenant `d7ac80b9-...`，本地构建看板空前先查这个。
- `facts.json` **不在仓库**，scorer 画像生成依赖它（缺失时 loadFacts 返回 []，服务不崩，仅画像无事实引用）。需恢复时另找文件放到 /opt/pcb-leadgen/facts/facts.json。
- 默认只起 gateway/scorer/mailer（看板+查询），不启 send/warmup worker；点「批准并发信」会停在 queued。
- **部署 = CI 自动（2026-10-15 起）**：push 到 main 触发 GitHub Actions（.github/workflows/deploy.yml → scripts/deploy-server.sh）：服务器 git reset --hard origin/main → pnpm install（npmmirror）→ 构建 dashboard → pm2 restart ecosystem.config.cjs → 健康检查（6 内部端口 + 公网 8090，fail-closed）。纯 md/docs/blog/.github 变更不触发。服务器 /opt/pcb-leadgen 已是 git 仓库，**不得在服务器上手改已跟踪文件**（会被 reset 丢弃）；未跟踪文件（ecosystem.config.cjs、apps/*/.env、facts/）安全。rsync 手动流程降级为备用（DEPLOY.md §5.2，且会与 git 工作区冲突，慎用）。回滚：服务器 git reset --hard <旧commit> + pm2 restart；源码备份在 /root/pcb-deploy-backups/。Secrets：SERVER_HOST / SERVER_USER / SERVER_SSH_KEY。
