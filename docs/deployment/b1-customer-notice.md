# EnergyBot B1 服务升级说明（致 A 版存量客户）

> **TL;DR：** 服务端新增了「我的 Bot」实时状态面板，需要您在自己的服务器上重跑一次一键安装脚本（大约 1 分钟）。bot 容器和 license 不会被动到，数据不会丢。

---

## 一、背景：B1 带来什么

A 版您已经在用的能力是 **License 颁发** —— 从控制台拿授权、在自己的服务器上装 bot 容器、用 license 激活。B1 在此之上增加了一条「客户终端 → 主站控制台」的长连接（WebSocket over TLS），解决的是一个很实际的问题：

> **之前**：bot 装完跑起来，主站只知道"license 已经被激活过"，再没法知道它是不是还活着、机器负载怎么样、什么时候掉线的。出问题只能靠您自己发现。
>
> **现在**：控制台新增「我的 Bot」页，可以实时看到：
>
> - 在线 / 离线状态（离线超过 90 秒自动置灰并通知）
> - 主机名、公网 IP、内核版本、agent 版本
> - 启动时间、累计运行时长、最近一次心跳时间
> - CPU 使用率、内存占用、1 分钟 load average

换句话说，这是一个**纯观测能力**，本身不会改变您 bot 的任何行为，也不会远程执行任何命令。B1 只铺通道，不下发动作——下发动作是后续 B2/B3 的事，届时会单独再发公告。

## 二、影响：需要做什么

**需要做：在您的服务器上重跑一次 `install.sh`。**

新版脚本除了您熟悉的 license 写入步骤以外，会多装一个约 3 MB 的 Go 二进制 agent（`energybot-agent`）和一份 systemd unit。agent 作为独立的系统服务运行，和您现有的 bot docker 容器**完全独立、互不影响**。

一键安装命令仍然在控制台「我的 License」页右上角「一键安装命令」按钮里，结构是：

```bash
curl -fsSL https://www.feiyijt.com/install.sh | sudo bash -s -- \
  --license-key=YOUR_LICENSE_KEY \
  --license-secret=YOUR_LICENSE_SECRET
```

（请从控制台复制，不要手抄参数。）

## 三、不影响：这些不会被动

- **bot docker 容器不会被重启、不会被停止、不会被删除**。新脚本只动 `/etc/energybot/` 和 `/opt/energybot-agent/`，不碰 docker。
- **license 不会丢**。`license.conf` 会被读取、校验后原地更新（如果内容相同则不写），不会重新颁发。
- **bot 的业务数据不会动**。您的 bot 里已有的会话、配置、日志都在原容器里，脚本不介入。
- **端口不变**。agent 走主动出站 443/TCP（WebSocket over TLS 到 `wss://www.feiyijt.com/agent`），**不监听任何入站端口**，不需要您开放任何端口。
- **不需要重启服务器**。

## 四、具体步骤

### 步骤 1：登录您的服务器

用您平时运维 bot 的那台服务器的 SSH 账号登录即可。需要 `sudo` 权限。

### 步骤 2：从控制台复制一键安装命令

登录 `https://www.feiyijt.com` → 左侧菜单「我的 License」→ 点右上角「一键安装命令」→ 复制完整命令（含 `--license-key` 和 `--license-secret`）。

### 步骤 3：在服务器上执行

把命令粘贴到终端回车，整个过程大约 60 秒。预期输出：

```
==> 校验授权 ... OK
==> 写入 /etc/energybot/license.conf ... OK
==> 检测架构 ... linux-amd64
==> 下载 agent 二进制 ... OK（sha256 校验通过）
==> 安装 systemd unit ... OK
==> 启动 energybot-agent 服务 ... OK

EnergyBot 安装完成。
  License：OK（剩余 XX 天）
  Agent：  running（PID XXXX）

下一步请登录 https://www.feiyijt.com 在「我的 Bot」页确认在线状态。
```

（`linux-amd64` 可能显示 `linux-arm64`，取决于您的服务器架构，两者都自动识别。）

### 步骤 4：确认 agent 已在运行

```bash
sudo systemctl status energybot-agent
```

看到 `active (running)` 即可。如果想看连上主站的日志：

```bash
sudo journalctl -u energybot-agent -n 50 --no-pager
```

应能看到类似 `connected to wss://www.feiyijt.com/agent` 和 `heartbeat sent` 的行。

### 步骤 5：在控制台确认在线

回到 `https://www.feiyijt.com` → 左侧菜单「我的 Bot」（A 版老账号可能需要**刷新一次页面**让新菜单出现）。应能看到：

- 主机名、公网 IP
- 在线状态徽标为绿色「online」
- CPU / 内存仪表盘开始跳动
- 最近心跳时间为刚刚（< 30 秒以内）

到此升级完成。

## 五、校验：怎么判断 B1 真的生效了

控制台「我的 Bot」页达到以下任一状态均视为生效：

- **仅有 1 台机器装了新 agent**：页面显示该机器的 `nz-descriptions` 详情卡 + CPU/内存 dashboard。
- **有多台机器**：`nz-table` 列出每一台的在线状态与关键指标，可展开看详情。
- **账号还没开通 license**：页面显示「当前账号未绑定客户」的提示（这是正常兜底，不是报错）。

如果装了新 `install.sh` 但页面仍显示「无 agent」超过 2 分钟，请看下一节「回滚」以及 FAQ 的网络排查部分。

## 六、回滚：如果新 agent 出问题怎么办

agent 设计上与 bot 完全解耦，任何异常都**不会影响 bot 运行**。但如果您仍想把 agent 停下来退回到 A 版行为，一条命令即可：

```bash
sudo systemctl disable --now energybot-agent
```

执行后：

- `energybot-agent` 进程停止，不再连主站。
- 控制台「我的 Bot」页该机器在 90 秒内自动转为离线（灰色）。
- bot 容器、license 配置、所有业务数据**完全不受影响**。

如果想**彻底卸载**（包括二进制和 systemd unit），跑官方 uninstall：

```bash
curl -fsSL https://www.feiyijt.com/install.sh | sudo bash -s -- --uninstall
```

注意 `--uninstall` **只清 agent 和 license 配置，不动 docker 和 bot 数据**（这是 A → B1 一贯的设计）。

## 七、已知限制

- **Cloudflare Free 计划 WebSocket 并发上限 100**。B1 初期远低于该阈值，后续客户量接近时会提前升级套餐或切换入口，届时不需要您做任何事。
- **A 版未升级的老机器不会自动变化**。A 版 `install.sh` 没有自更新通道，需要您按本说明手动重跑才能拿到 B1 能力。如果某台机器暂时不方便升级，它会维持 A 版行为（可以继续激活、可以继续用，但「我的 Bot」里看不到它）。
- **控制台的 agent 信息是只读的**。B1 只展示状态，不支持从控制台重启、配置下发、命令执行。这些能力在 B2 里规划，会单独发公告。
- **首次连接可能需要 3–5 秒出现 online**。这是正常的握手 + 心跳节奏（心跳周期 30 秒，但连上会立即发一次），请耐心刷新。

## 八、后续：B2 预告

B2 的主题是**双向控制**：在 B1 通道上加动作下发（重启 bot、刷新配置、推送模板更新等）。届时同样会提前通过本页面 + 邮件通知，并在控制台显示「有新版本可升级」提示。B2 不会要求您重装二进制，而是 agent 自动平滑升级。

---

## 九、FAQ

### Q1：不升级会怎样？

A：A 版功能继续可用，license 照常激活，bot 照常运行。只是「我的 Bot」页看不到您这台机器，主站也没法感知它是否在线。从功能上是**可以不升**的，但推荐升级，因为后续 B2 的能力都会以 B1 为前置。

### Q2：升级过程中 bot 会断吗？

A：不会。`install.sh` 不碰 docker，整个过程只装 agent 二进制和 systemd unit。bot 容器一直在跑。

### Q3：agent 会占多少资源？

A：二进制约 3 MB，常驻内存约 10–20 MB，CPU 几乎为 0（每 30 秒采集一次主机指标后立即让出）。启动后 systemd 自动托管，崩溃会自动拉起。

### Q4：agent 会不会把我的数据发走？

A：agent 只上报**主机级别的公开指标**——hostname、公网 IP（通过外部 DNS 查询获得）、内核版本、启动时间、CPU%、内存已用/总量、load average 1 分钟。**不读取 bot 容器内的任何数据**，**不读取任何用户目录**。systemd unit 里已配置 `ProtectSystem=strict` + `ProtectHome=true` + 白名单目录，文件系统访问被内核级别隔离。

### Q5：agent 之间的通讯是加密的吗？

A：是。全程 WebSocket over TLS（CF 接管 TLS 1.2/1.3），每条握手帧用您的 license HMAC-SHA256 签名，服务端只接受 5 分钟内的带签名帧，nonce 单次有效。没有您的 `license-secret` 没法伪造连接。

### Q6：如果同一 license 被装到两台机器上会怎样？

A：后一台连接建立时，主站会向前一台发送 close code 4001 主动断开（设计上叫「后来者赢」），以防止两个 agent 混淆同一身份上报指标。如果您确实有合法的多机器需求，请联系客服开通多 license，或者升级到支持多节点的套餐。

### Q7：如何向你们反馈问题？

A：

- 技术问题：控制台右上角「提交反馈」，带上 `journalctl -u energybot-agent -n 200` 的输出。
- 紧急问题：您原有的商务或技术支持渠道。

感谢您的配合。有任何疑问欢迎随时反馈。

— EnergyBot 团队
2026-05-04
