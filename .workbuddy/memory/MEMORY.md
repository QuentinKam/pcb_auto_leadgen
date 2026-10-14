# 项目长期记忆 — pcb_auto_leadgen

## 部署（阿里云 47.251.97.20，宝塔 + 原生 PG13 + Redis6 + PM2，非 Docker）
- 形态：演示(8090 公开) / 生产(8091 basic auth，用户 pcbadmin，密码在 /root/.pcb_basicauth_pass)。详见仓库 DEPLOY.md。
- `ecosystem.config.cjs` 是**服务器专属、不入仓库**的文件（含真实 PG 密码，600 权限）。服务器上若丢失，必须按 DEPLOY.md §2/§9 重建 6 进程并注入：DATABASE_URL（真实密码读 /root/.pcb_pgpw）、REDIS_URL（demo /5、prod /6）、TENANT_ID=00000000-0000-0000-0000-000000000000、PORT、scorer 的 FACTS_JSON_PATH。本地 apps/*/.env 的 DATABASE_URL 是假密码 `dev_only_local`，靠 PM2 env 覆盖。
- **dashboard 构建前必须把 `apps/dashboard/.env` 的 VITE_TENANT_ID 改成 `00000000-...`**（本地那份是 dev tenant，会导致看板四个 Tab 全空）。VITE_ 变量是构建时写死的。
- `facts.json` **不在仓库**，scorer 画像生成依赖它（缺失时 loadFacts 返回 []，服务不崩，仅画像无事实引用）。需恢复时另找文件放到 /opt/pcb-leadgen/facts/facts.json。
- 默认只起 gateway/scorer/mailer（看板+查询），不启 send/warmup worker；点「批准并发信」会停在 queued。
- 部署命令模板见 DEPLOY.md §5；rsync 后务必 `chown -R root:root`（本机 uid 501 在服务器是 games 账号）。
