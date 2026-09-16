---
name: troubleshoot-pcb-server
description: 线上 PCB 服务故障排查手册，覆盖 502/504/500、COLLECTOR_UNAVAILABLE、socket closed、PM2 崩溃重启、OOM、采集失败、健康检查异常。当用户反馈线上报错、页面 502、一键采集失败或服务不可用时使用。代码重新部署改用 deploy-pcb-leadgen。
---

# PCB 线上服务故障排查

定位并修复阿里云服务器 `47.251.97.20` 上 PCB 获客系统的运行时故障。机器仅 2 vCPU / 1.8G 内存，资源类故障高发。

## 环境速查

| 项 | 值 |
|---|---|
| 服务器 | `root@47.251.97.20` |
| SSH 密钥 | `/Users/quentingam/Downloads/new_aliyun.pem`（`~/.ssh/new_aliyun.pem` 有副本） |
| 代码目录 | `/opt/pcb-leadgen`（ecosystem.config.cjs 只存在于服务器，有 .bak 备份） |
| DB 密码 | 服务器本地 `/root/.pcb_pgpw` |
| nginx 入口 | 8090 演示（公开）/ 8091 生产（basic auth） |

每套环境 4 个服务，端口与中间件：

| 服务 | demo | prod |
|---|---|---|
| gateway（唯一对公入口） | 3011 | 3021 |
| collector | 3014 | 3024 |
| scorer | 3012 | 3022 |
| mailer | 3013 | 3023 |
| PostgreSQL 库 | pcb_leadgen_demo | pcb_leadgen |
| Redis DB | 5 | 6 |

PM2 进程名：`pcb-{demo,prod}-{gateway,collector,scorer,mailer}`。同机还跑着 bps / nextjs_tob_1 / protein_value，**任何 kill/重启操作不得波及它们**。

## 排查总则：先定位分层，再动手

请求链路：浏览器 → nginx(8090/8091) → gateway(3011/3021) → collector/scorer/mailer。

1. 先跑巡检脚本 `scripts/health.sh`，拿到 8 个服务健康码 + PM2 重启次数（↺）。
2. 按报错特征对照下面的「症状手册」收敛根因，**不要没看证据就改代码**。
3. 修复后必须经公网复测（curl 8090/8091），并 `pm2 save`。

常用只读诊断命令：

```bash
ssh -i /Users/quentingam/Downloads/new_aliyun.pem root@47.251.97.20 '
  pm2 list                                   # ↺ 列 >0 说明在崩溃重启
  pm2 logs pcb-demo-collector --lines 50 --nostream --err
  pm2 env 17 | grep -E "PORT|_URL"           # 进程实际环境变量（id 从 pm2 list 取）
  dmesg -T | grep -iE "killed process|out of memory" | tail
  free -m; swapon --show; cat /proc/sys/vm/swappiness
  ss -ltnp | grep -E ":30[12][0-9]"
'
```

## 症状手册

### 502 COLLECTOR_UNAVAILABLE: Unable to connect（连接被拒）

gateway 到下游是 connection refused：**下游进程没监听端口**。

- `pm2 list` 确认 collector 是否存在/online；查 `pm2 env <gateway-id> | grep COLLECTOR_URL` 是否指向正确端口。
- 2026-09-16 曾因 ecosystem 的 stack() 只定义了 gateway/scorer/mailer、从未启动 collector 导致。修复=在 `/opt/pcb-leadgen/ecosystem.config.cjs` 补 collector app 并给 gateway 注入 `COLLECTOR_URL`，再按下节方式 reload。
- 进程存在但健康检查非 200：看 `--err` 日志（常见为 SyntaxError，见代码漂移条目）。

### 502 COLLECTOR_UNAVAILABLE: socket connection was closed unexpectedly

连接建立后中途断开 = **下游进程处理中崩溃**（不是超时）。

1. `pm2 list` 看 ↺ 是否 +1、uptime 是否归零；
2. `dmesg -T | grep "Killed process"` 确认是否内核 OOM；
3. dmesg 无记录但 ↺ 增长，查 `pm2 describe <id> | grep -A1 "max memory restart"`：可能是单进程超 250M 被 PM2 内存重启（现象与 OOM 相同但无内核日志，典型峰值 196MB、余量很小，遇到超大年报可能触发）。复发时把 ecosystem 里 `COLLECTOR_EDGAR_CONCURRENCY` 降到 1，不要调大 max_memory_restart（整机只有 1.8G）；
4. 是内核 OOM 走下面「OOM 处置」；否则看 err 日志找未捕获异常。

### OOM（Killed process ... bun）

机器 1.8G 内存，突发大对象会被内核 OOM killer 秒杀，5 秒级 RSS 采样可能抓不到峰值。

- 用 `scripts/mem-watch.sh pcb-demo-collector 2 75` 以 2 秒间隔采样复现，峰值 RSS 以 dmesg 的 anon-rss 为准。
- 已知内存热点与约束：
  - EDGAR 10-K 解析：2026-09-16 起已移除 cheerio/parse5（DOM 放大会把数十 MB 的年报放大到 500MB+ 导致 OOM），改为正则 htmlToText + 流式下载字节上限（年报 15MB / 网页 5MB）。**不要再在 edgar 路径引回 cheerio 全量解析。**
  - 并发由 `COLLECTOR_EDGAR_CONCURRENCY` 控制（默认 3，服务器 ecosystem 注入 2）。
- 系统兜底：`vm.swappiness` 必须是 30（阿里云镜像默认 0，有 2G swap 也不用），持久化在 `/etc/sysctl.conf` 和 `/etc/sysctl.d/50-aliyun.conf` 两处；`sysctl -w vm.swappiness=30` 立即生效。
- 压测批量：24 家（3 关键词 × 8）采集峰值应约 200MB、22 秒完成。

### 504 COLLECTOR_TIMEOUT

下游存活但处理超 120 秒（gateway 转发超时，见 apps/gateway/src/routes/collectors.ts TIMEOUT_MS）。多为 EDGAR 大批量 + 网络慢。处理：减小 limitPerKeyword/关键词数，或查 collector out 日志卡在哪一步；不要盲目调大超时。

### 500 column does not exist / relation does not exist

代码与数据库 schema 漂移。**禁止手动 ALTER TABLE**，按 deploy-pcb-leadgen 的迁移步骤对两套库跑 `pnpm --filter @pcb/db migrate`（先确认 drizzle 迁移文件已生成并部署）。

### 启动崩溃 SyntaxError: Export named X not found（代码漂移）

只 scp 了单个文件、服务器其余文件落后于本地提交时会出现（曾导致 PM2 崩溃循环 ↺17）。处置：全量同步整个 app 目录而不是补单文件。

```bash
rsync -az --exclude node_modules --exclude .env --exclude dist \
  -e "ssh -i /Users/quentingam/Downloads/new_aliyun.pem" \
  /本地路径/apps/collector/ root@47.251.97.20:/opt/pcb-leadgen/apps/collector/
ssh -i /Users/quentingam/Downloads/new_aliyun.pem root@47.251.97.20 \
  'chown -R root:root /opt/pcb-leadgen/apps/collector'
```

## PM2 关键陷阱

- **改了 ecosystem 里的 env，`pm2 restart X --update-env` 不生效**——它注入的是当前 shell 环境，不重读配置文件。必须：
  ```bash
  cd /opt/pcb-leadgen
  pm2 start ecosystem.config.cjs --only pcb-demo-collector --update-env
  pm2 save
  ```
  改后用 `pm2 env <id> | grep VAR` 验证。
- `pm2 update` 会丢进程表，立刻 `pm2 resurrect && pm2 save`（约 1 分钟中断）。
- bun 服务必须以 `bun run src/index.ts` 作为入口直接跑（ecosystem 已配好 interpreter none），用 PM2 bun interpreter import 模块会假监听。
- `max_memory_restart 250M` 是单进程上限；OOM killer 是系统级行为，两者都要关注。

## SSH 操作陷阱

- `ssh ... 'pkill -f xxx'` 若命令行其他位置（如日志文件名）也含 xxx，会杀掉自己的远程 shell，本地收到 exit 255。用方括号技巧 `pkill -f mem-monito[r]`，或避免同一命令里出现该字面量。
- 需要在远端跑后台监控时：写脚本到 /tmp，`nohup /tmp/x.sh >/tmp/x.log 2>&1 &`，脚本自带次数上限自动退出，事后删文件。

## 修复验收

- `scripts/health.sh`：8 端口全 200，↺ 不再增长；
- 公网复测触发故障的操作（如 POST http://47.251.97.20:8090/api/collectors/run 小批量 → 大批量）；
- `pm2 save` 已执行；dmesg 无新的 Killed process；
- bps / nextjs_tob_1 / protein_value 保持 online。
