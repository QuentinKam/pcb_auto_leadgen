# 项目长期记忆 — pcb_auto_leadgen

## 套件关系（三个目录是一套，详见 AGENTS.md §12）
- pcb_knowledge_base（知识源 md）→ ContentForge（aigc_base_knowledge 仓库，`contentforge ingest pcb` 提炼，纯标准库无 LLM 依赖）→ 登记册 facts.json → 本仓库 scorer。三仓库均为 GitHub public（QuentinKam/pcb_knowledge_base、aigc_base_knowledge、pcb_auto_leadgen），服务器 /opt 下各有 clone。知识库更新：push KB → SSH 跑 `/opt/aigc_base_knowledge/regenerate-facts.sh`（pull+ingest+重启+验证）；Mac 快通道是 scripts/sync-facts.sh。
- 服务器 aigc 仓库的 workspace.json（kb_path=/opt/pcb_knowledge_base）、facts.json、kbmeta/ingest_report.json 都设了 git skip-worktree——服务器 ingest 产物本地优先，不被 pull 覆盖。

## 部署（阿里云 47.251.97.20，宝塔 + 原生 PG13 + Redis6 + PM2，非 Docker）
- 形态：演示(8090 公开) / 生产(8091 basic auth，用户 pcbadmin，密码在 /root/.pcb_basicauth_pass)。详见仓库 DEPLOY.md。
- `ecosystem.config.cjs` 是**服务器专属、不入仓库**的文件（含真实 PG 密码，600 权限）。服务器上若丢失，必须按 DEPLOY.md §2/§9 重建 6 进程并注入：DATABASE_URL（真实密码读 /root/.pcb_pgpw）、REDIS_URL（demo /5、prod /6）、TENANT_ID=00000000-0000-0000-0000-000000000000、PORT、scorer 的 FACTS_JSON_PATH。本地 apps/*/.env 的 DATABASE_URL 是假密码 `dev_only_local`，靠 PM2 env 覆盖。
- **dashboard 构建**：VITE_TENANT_ID 构建时写死。服务器 apps/dashboard/.env 是 `00000000-...`（不入库、CI 不会覆盖）；本地那份是 dev tenant `d7ac80b9-...`，本地构建看板空前先查这个。
- `facts.json` 不在本仓库，源头在 aigc_base_knowledge 仓库 `contentforge/workspaces/pcb/registry/facts.json`（git 跟踪，由 pcb_knowledge_base 的 md 生成，203 条）。服务器 scorer 直接读服务器 clone 的登记册（ecosystem FACTS_JSON_PATH=/opt/aigc_base_knowledge/contentforge/workspaces/pcb/registry/facts.json）；旧副本 /opt/pcb-leadgen/facts/ 已删。2026-10-15 验证 loadFacts 返回 199 条（4 条 template 被过滤）。本地 apps/scorer/.env 的 FACTS_JSON_PATH 指向 PCB_ALL 下的实际路径。
- 服务器装了 python3.11（dnf，系统仍是 3.6.8），ingest 用 `python3.11 src/main.py ingest pcb`（在 contentforge 目录）。
- 进程数：2026-10-15 起每套环境 4 个（gateway/scorer/mailer/collector），端口 demo 3011-3014、prod 3021-3024；仍不启 send/warmup worker，点「批准并发信」会停在 queued。
- **gateway 下游地址必须靠 PM2 env 注入**（代码默认是开发端口 3002/3003/3004，与服务器不符）：demo gateway 注入 SCORER_URL=3012/MAILER_URL=3013/COLLECTOR_URL=3014，prod 对应 3022/3023/3024；collector 也需 SCORER_URL=3012(3022) 才能回调打分。缺注入的表现是服务全 online、/health 全 200，但看板报 Collector/Scorer/Mailer unavailable、画像生成失败。
- collector 的 apps/collector/.env（dev 租户 ID、假库密码、SCORER_URL=3002）全部靠 PM2 env 覆盖，不要在服务器上手改。
- **部署 = CI 自动（2026-10-15 起）**：push 到 main 触发 GitHub Actions（.github/workflows/deploy.yml → scripts/deploy-server.sh）：服务器 git reset --hard origin/main → pnpm install（npmmirror）→ 构建 dashboard → pm2 restart ecosystem.config.cjs → 健康检查（8 内部端口 + 公网 8090，fail-closed）。纯 md/docs/blog/.github 变更不触发。服务器 /opt/pcb-leadgen 已是 git 仓库，**不得在服务器上手改已跟踪文件**（会被 reset 丢弃）；未跟踪文件（ecosystem.config.cjs、apps/*/.env、facts/）安全。rsync 手动流程降级为备用（DEPLOY.md §5.2，且会与 git 工作区冲突，慎用）。回滚：服务器 git reset --hard <旧commit> + pm2 restart；源码备份在 /root/pcb-deploy-backups/。Secrets：SERVER_HOST / SERVER_USER / SERVER_SSH_KEY。

## 鉴权架构（2026-10-16 启用 JWT 真隔离）
- prod(8091) 网关 `AUTH_MODE=required`（注入在 ecosystem.config.cjs 的 prod-gateway env），demo(8090) 保持 off。gateway 只认 `Authorization: Bearer <JWT>`（需 JWT_SECRET）或 `X-Api-Key`（需 GATEWAY_API_KEY），不认 nginx basic auth 头。
- 选 JWT 模式（非 API Key）：tenant_id 强制取自 token，请求头无法冒充——真正租户隔离；API Key 模式 tenant 仍取请求头，隔离不彻底。
- token 签发：`POST /api/auth/token`（apps/gateway/src/routes/auth.ts），从 nginx 透传的 `Authorization: Basic` 解用户名，用 JWT_SECRET 签 HS256 JWT（sub+tenant_id+exp=12h）。端点被 auth 中间件白名单放行（避免"要 token 才能拿 token"死循环）。
- 前端 apps/dashboard/src/lib/api.ts lazy token：首请求遇 401 自动调 /api/auth/token（浏览器带 basic auth）拿 JWT 缓存、重发带 Bearer；demo off 首请求 200 不触发，一份前端兼容两环境。
- nginx pcb-prod.conf 的 location /api/ 已加 `proxy_set_header Authorization $http_authorization;` 透传 basic auth。
- JWT_SECRET=`openssl rand -hex 32` 生成，写在 ecosystem.config.cjs（600，不入库）。轮换须同步改 ecosystem + 重启 prod-gateway。
- basic auth 是"登录层"（nginx 弹窗），JWT 是"请求鉴权+强制租户"，两者并存。
