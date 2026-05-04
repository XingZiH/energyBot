# 能源租赁机器人：Agent WSS 反向通道（子系统 B1）

**起草日期**：2026-05-04
**涉及范围**：新建 `go-agent/` + 后端 `nest-api/src/modules/agent/` + 前端 `ui/src/app/pages/account/my-bot/` + 部署脚本 `scripts/install.sh` + 生产 nginx + DB migration
**关联前置**：子系统 A 已上线，license 颁发 + install.sh 部署已闭环，生产域名 `https://www.feiyijt.com` 可用。
**关联后续**：B2（配置下发 + 热加载）→ B3（go-bot 迁移 + Telegram bot 端到端运行）

---

## 1. 背景与子系统 B 切片决策

子系统 A 把 license 颁发打通后，客户已经能拿到命令、跑完 install.sh、把 license.conf 落到机器上。但此时控制台对这台机器一无所知——license 只是张"出门证"，没有对应的"身份识别通道"。

子系统 B 的目标是**建立双向反向通道**，让：

1. 控制台能看到每台客户机器的在线状态、心跳、资源使用
2. 控制台能把配置下发给每台机器
3. 控制台能远程启停客户机器上的 bot
4. 客户机器上的 bot 能回传运行事件

这四个目标无法一次做完——基于 2026-05-04 对 `go-bot/` 9,139 行代码的调研，最后一项（go-bot 迁移）因为对 PostgreSQL 的深度绑定、~50 条 SQL 的 SQLite 方言重写、`IS NOT DISTINCT FROM`/`FOR UPDATE`/表达式 UNIQUE 索引等差异、botruntime SaaS 多租户逻辑的重构，**单独就需要 10 天以上**。

所以子系统 B 按风险分层拆为三刀：

| 子刀 | 独立价值 | 工时 | 本规格覆盖 |
|---|---|---|---|
| **B1：WSS 通道 + 心跳 + 在线状态** | 控制台能看到"客户机器在不在"，具备基础运维可见性 | 4-5 天 | ✅ |
| B2：配置下发 + agent 端热加载 | 控制台能改配置、agent 应用、落 SQLite | 3-4 天 | ❌（下一份规格） |
| B3：go-bot 迁移 + Telegram bot spawn | 端到端跑通 Telegram bot，完整 BaaS 产品 | 10-13 天 | ❌（再下一份规格） |

**B1 独立可用**：完成后，客户跑完 install.sh → 自动下载 agent 二进制 → systemd 拉起 → wss 连上控制台 → 客户登录「我的 Bot」页能看到 🟢 在线 + 心跳滚动。这已经是有商业价值的交付：客户知道自己服务器活着、控制台知道谁在线。

---

## 2. 成功标准

1. 客户跑完 install.sh（不变的 license 一行命令）→ 最后一段自动下载 `energybot-agent` 二进制 + 注册 systemd + enable。客户**无需任何额外动作**。
2. 客户登录控制台 → 菜单「账户中心 → 我的 Bot」→ 看到自己服务器的 🟢 在线 + 最近心跳「刚刚」+ 主机名 + 操作系统 + agent 版本 + CPU/内存使用率。
3. 客户 `systemctl restart energybot-agent` → 控制台在 3 秒内变 ⚫ 再变 🟢。
4. 客户 `systemctl stop energybot-agent` → 控制台在 90 秒内变 ⚫。
5. 同一 license 在两台机器同时装 agent：后装的那台连上，先装的那台被控制台主动踢下（WebSocket close code 4001 "replaced_by_newer_connection"）+ 先装那台的 systemd 收到 exit code 42 后**不自动重启**。
6. 管理员在后台吊销 license → 对应 agent 在下一次心跳时收到 close 4003 "license_revoked" → systemd 不重启 + journal 日志明确写 `license revoked, exiting`。
7. 签名失败（timestamp 超窗 / nonce 重放 / HMAC 错）→ 控制台 close 4013 / 4003 对应错误码 + agent 端重连（非 4001 / 4003 均重连）。
8. Agent 使用指数退避重连：1s → 2s → 4s → 8s → ... → 最多 300s。连接成功后 backoff 重置。
9. 所有新增后端接口走 JwtGuard + AuthGuard + `@Permission` 三件套，permission code = `default:account:my-bot[:action]`。Role 1/2/3 自动获得 `default:account:my-bot`。
10. 后端 jest + 前端 karma + Go test 三端增量用例全绿；基线 2 个 `energy-rental.service.spec.ts` 失败不计入回归。
11. 部署：
    - DB migration `20260504-agents-table.sql` 在生产应用成功，回滚 SQL 预备。
    - nginx 新增 `/agent` → `maer-energy-api:3001/agent` 的 WebSocket upgrade 转发。
    - `/opt/maer-energy/public/bin/energybot-agent-linux-{amd64,arm64}` 上线。
    - `/opt/maer-energy/public/systemd/energybot-agent.service` 上线。
    - `/opt/maer-energy/public/install.sh` 更新，增加 `install_agent()` 步骤。
    - 43.119.5.98 测试机上的 agent 上线 + 控制台可见。

---

## 3. 整体架构

```
┌──────────────────┐         wss (JSON-RPC 2.0 frames)         ┌─────────────────────┐
│  Go agent        │◄────────────────────────────────────────►│  NestJS             │
│  (客户服务器)     │                                          │  AgentGateway       │
│                  │   1. dial wss://www.feiyijt.com/agent    │  (@WebSocketGateway) │
│  /etc/energybot/ │      with HTTP headers:                  │                     │
│    license.conf  │        X-License-Key                     │  连接状态流转:        │
│  (600, by inst.  │        X-Timestamp / X-Nonce             │  1. handleConnection │
│   sh from A)     │        X-Agent-Version                   │  2. 校验 HMAC 签名   │
│                  │        X-Signature (HMAC-SHA256)         │  3. 从 license 查    │
│  run loop:       │                                          │     customerId       │
│   connect →      │   2. 握手：NestJS 验证 ±30s + nonce +    │  4. 登记到           │
│    send hello →  │      HMAC → 成功: emit hello.ack        │     AgentRegistry    │
│    每30s 心跳    │                                          │     （Map<customerId,│
│    → 断重连      │   3. 心跳每 30s:                         │       WebSocket>）   │
│     指数退避     │      agent → server: heartbeat           │                     │
│                  │        {uptime, cpu, mem, loadavg}       │  5. 旧连 300ms 抗抖 │
│                  │      server → agent: heartbeat.ack       │     动窗口 + 踢掉    │
│                  │                                          │     (close 4001)     │
│                  │   4. 断连:                               │                     │
│                  │      server: UPDATE agents SET           │  6. 心跳落 agents    │
│                  │        status='offline'                  │     表 + 去抖 DB 写  │
│                  │      agent: exponential backoff 重连     │                     │
│                  │        (1s→2s→...→300s)                  │  7. Cron 每 30s 扫   │
└──────────────────┘                                          │     last_hb<now-90s  │
                                                              │     → mark offline   │
                                                              └─────────────────────┘
                                                                         │
                                                                         ▼
                                                              ┌─────────────────────┐
                                                              │  PostgreSQL          │
                                                              │  新表 agents         │
                                                              │  (license_id UNIQUE) │
                                                              └─────────────────────┘
                                                                         │
                                                                         ▼
                                                              ┌─────────────────────┐
                                                              │  Angular            │
                                                              │  「我的 Bot」v0.1   │
                                                              │  GET /default/      │
                                                              │  account/my-bot/    │
                                                              │  status              │
                                                              └─────────────────────┘
```

---

## 4. 数据模型

### 4.1 新表 `agents`

```sql
-- nest-api/sql/20260504-agents-table.sql

CREATE TABLE agents (
  id                 BIGSERIAL PRIMARY KEY,
  license_id         BIGINT    NOT NULL UNIQUE REFERENCES licenses(id) ON DELETE CASCADE,
  customer_id        BIGINT    NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  -- 在线状态
  status             VARCHAR(16) NOT NULL DEFAULT 'offline',   -- 'online' | 'offline'
  connected_at       TIMESTAMPTZ,
  disconnected_at    TIMESTAMPTZ,
  last_heartbeat_at  TIMESTAMPTZ,

  -- 主机信息（hello 帧上报，每次重连覆盖写）
  host_name          VARCHAR(255),
  os_info            VARCHAR(255),
  agent_version      VARCHAR(32),
  public_ip          INET,

  -- 心跳负载（最后一次）
  uptime_seconds     BIGINT,
  cpu_percent        NUMERIC(5,2),
  mem_used_mb        INTEGER,
  mem_total_mb       INTEGER,
  loadavg_1          NUMERIC(6,2),

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ
);

CREATE INDEX idx_agents_customer ON agents(customer_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_agents_status ON agents(status) WHERE deleted_at IS NULL;

-- 权限
INSERT INTO sys_role_perm (role_id, perm_key) VALUES
  (1, 'default:account:my-bot'),
  (2, 'default:account:my-bot'),
  (3, 'default:account:my-bot');
```

**回滚 SQL `20260504-agents-table.rollback.sql`**：

```sql
DELETE FROM sys_role_perm WHERE perm_key LIKE 'default:account:my-bot%';
DROP TABLE IF EXISTS agents;
```

**设计要点**：

- **一 license 一 agent**（`UNIQUE(license_id)`）→ 呼应"后来者赢"策略。
- **customer_id 冗余**：所有查询都是 "这个客户的 agent"，省一次 join。
- **心跳字段直接写 agents 行**：B1 阶段不做时序曲线，心跳覆盖写。
- **不设 agent_token 列**：鉴权直接复用 license HMAC，agent 无长期凭据，吊销 license 即吊销 agent。
- **public_ip 用 INET 类型**：pg 原生支持，便于后续 IP 归属地查询。

### 4.2 与现有 `bot_runtime_status` 的关系

`go-bot/` 已有 `bot_runtime_status` 表，语义是 **bot 有没有启起来**（面向 SaaS 运维）。`agents` 表语义是 **agent 进程有没有连上**（面向客户自托管）。B3 阶段两表并存：`agents` 管"连没连"，`bot_runtime_status` 管"bot 启没启"。

---

## 5. Wire Protocol（wss 上的 JSON-RPC 2.0 帧）

### 5.1 连接握手（HTTP Upgrade 阶段的 headers）

```http
GET /agent HTTP/1.1
Host: www.feiyijt.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: <RFC 6455>
Sec-WebSocket-Version: 13
X-License-Key:   ebt_PkVCTcfGw4EJNiWfLpPbEDS28pGzg2PAy
X-Timestamp:     1730721234
X-Nonce:         8f3c-...32hex
X-Agent-Version: 0.1.0
X-Signature:     base64(HMAC-SHA256(license_secret,
                   "CONNECT\n/agent\n1730721234\n8f3c-...\n<sha256 of empty string>"))
```

签名规范与子系统 A 的 `install.sh` precheck 完全一致——复用 `LicenseService.verifyPrecheckSignature` 和 `NonceCacheService`，无需新签名算法。

### 5.2 连接建立后的 JSON-RPC 帧

**agent → server：hello（连接后首帧，必发）**：
```jsonc
{ "jsonrpc":"2.0", "id":1, "method":"agent.hello", "params":{
  "agent_version":"0.1.0",
  "host_name":"customer-srv-01",
  "os_info":"Linux 6.8.0-1024-aws x86_64",
  "boot_time":1730700000
}}
```

**server → agent：hello.ack**：
```jsonc
{ "jsonrpc":"2.0", "id":1, "result":{
  "agent_id":42,
  "heartbeat_interval_sec":30,
  "server_time":1730721235
}}
```

**agent → server：heartbeat（周期性）**：
```jsonc
{ "jsonrpc":"2.0", "id":N, "method":"agent.heartbeat", "params":{
  "uptime_seconds":3600,
  "cpu_percent":5.2,
  "mem_used_mb":1024,
  "mem_total_mb":8192,
  "loadavg_1":0.31
}}
```

**server → agent：heartbeat.ack**：
```jsonc
{ "jsonrpc":"2.0", "id":N, "result":{ "ok":true, "server_time":1730721265 }}
```

### 5.3 JSON-RPC 2.0 错误码

| code | 含义 | 触发场景 |
|---|---|---|
| -32700 | Parse error | JSON 反序列化失败 |
| -32600 | Invalid Request | 缺 jsonrpc/method 字段 |
| -32601 | Method not found | 方法名未知（B2 开始才有多方法） |
| -32602 | Invalid params | params 字段不符合 DTO |
| -40001 | License not found/revoked | 查 license 表无果或 revoked |
| -40003 | Signature invalid | HMAC 验签失败 |
| -40013 | Timestamp out of window | abs(server_now - ts) > 30s |
| -40029 | Nonce replay | nonce 在 NonceCacheService 已存在 |
| -40041 | Replaced by newer connection | 后来者赢，旧连被踢 |

### 5.4 WebSocket close codes（agent 行为约定）

| code | reason | agent 行为 |
|---|---|---|
| 1000 | normal closure | 正常结束，退出 exit 0 |
| 1006 | abnormal closure | 网络中断，触发重连 |
| 4001 | replaced_by_newer_connection | 退出 exit 42（RestartPreventExitStatus=42） |
| 4003 | license_revoked | 退出 exit 42（不重启） |
| 4013 | timestamp_out_of_window 或 nonce_replay | 退出 exit 1（允许重连，下次时钟修正） |

**设计依据**：

- 4001 给 systemd "别重试" 信号，避免两台机器形成重连风暴。
- 4003 同样 exit 42，运维 `systemctl status` 能看到 agent 因 license 吊销退出。
- 4013 允许重连，用户机器时钟可能短时漂移，重试后新 ts 就在窗口内了。

---

## 6. NestJS 后端架构

### 6.1 新模块结构

```
nest-api/src/modules/agent/
├── agent.module.ts                    -- 声明依赖：LicenseModule, CustomerModule, SharedCryptoModule
├── agent.gateway.ts                   -- @WebSocketGateway，handleConnection/Disconnect/Message
├── agent.service.ts                   -- upsertOnConnect、updateHeartbeat、markOffline、getStatusByCustomer
├── agent-registry.service.ts          -- 进程内 Map<customerId, ConnInfo>，后来者赢 + 300ms 抗抖
├── agent-offline-scheduler.service.ts -- @Cron('*/30 * * * * *') 扫 last_heartbeat_at < now-90s
├── agent.controller.ts                -- GET /default/account/my-bot/status
├── dto/
│   ├── hello.dto.ts                   -- class-validator
│   └── heartbeat.dto.ts
├── jsonrpc.util.ts                    -- encode/decode + error 构造
└── spec/
    ├── agent.service.spec.ts
    ├── agent-registry.service.spec.ts
    └── jsonrpc.util.spec.ts
```

### 6.2 依赖新包

```json
// nest-api/package.json
{
  "dependencies": {
    "@nestjs/platform-ws": "^11.x",
    "@nestjs/websockets":  "^11.x",
    "ws":                  "^8.x"
  },
  "devDependencies": {
    "@types/ws":           "^8.x"
  }
}
```

**注意**：用 `platform-ws` 而非 `platform-socket.io`——Go agent 用纯 WebSocket，socket.io 协议层不兼容。

### 6.3 AgentGateway 握手逻辑（伪代码）

```typescript
@WebSocketGateway({ path: '/agent', transports: ['websocket'] })
export class AgentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  async handleConnection(client: WebSocket, request: IncomingMessage) {
    try {
      const headers = this.extractHeaders(request);
      // 1. 时间戳窗口
      if (Math.abs(Date.now()/1000 - headers.timestamp) > 30)
        return this.closeWith(client, 4013, 'timestamp_out_of_window');

      // 2. nonce 重放
      if (!await this.nonceCache.claim(headers.nonce, 60))
        return this.closeWith(client, 4013, 'nonce_replay');

      // 3. 查 license
      const license = await this.licenseService.findByKey(headers.licenseKey);
      if (!license || license.status === 'revoked')
        return this.closeWith(client, 4003, 'license_revoked');

      // 4. HMAC 验签
      // 复用现有 LicenseService 的验签路径；secret 解密在 service 内部进行
      const ok = this.licenseService.verifyPrecheckSignature({
        licenseId: license.id,
        method: 'CONNECT', path: '/agent',
        timestamp: headers.timestamp, nonce: headers.nonce,
        bodySha256: EMPTY_SHA256,
        signature: headers.signature,
      });
      if (!ok) return this.closeWith(client, 4003, 'signature_invalid');

      // 5. 挂上 customerId 到 client，等 hello 帧
      (client as any).customerId = license.customer_id;
      (client as any).licenseId = license.id;
    } catch (e) {
      this.logger.error('handshake failed', e);
      client.close(1011, 'internal_error');
    }
  }

  @SubscribeMessage('agent.hello')
  async onHello(client: WebSocket, payload: HelloDto) {
    // 1. 300ms 抗抖：查 registry 旧连
    const reg = this.registry.claim(client.customerId, client, payload.boot_time);
    if (reg.rejected) return this.closeWith(client, 4013, 'concurrent_connect');

    // 2. upsert agents 行
    const agent = await this.agentService.upsertOnConnect({
      licenseId: client.licenseId,
      customerId: client.customerId,
      ...payload,
      publicIp: this.extractRemoteAddr(client),
    });

    // 3. 回 hello.ack
    this.sendRpc(client, { id: payload.__id, result: {
      agent_id: agent.id,
      heartbeat_interval_sec: 30,
      server_time: Math.floor(Date.now()/1000),
    }});
  }

  @SubscribeMessage('agent.heartbeat')
  async onHeartbeat(client: WebSocket, payload: HeartbeatDto) {
    // 心跳时再次校验 license 状态（容忍最多 30s 延迟，吊销后最长 30s agent 下线）
    const stillValid = await this.licenseService.isActive(client.licenseId);
    if (!stillValid) {
      return this.closeWith(client, 4003, 'license_revoked');
    }
    await this.agentService.updateHeartbeat(client.licenseId, payload);
    this.sendRpc(client, { id: payload.__id, result: { ok: true, server_time: ... }});
  }

  async handleDisconnect(client: WebSocket) {
    if (client.licenseId) {
      this.registry.remove(client.customerId, client);
      await this.agentService.markOffline(client.licenseId);
    }
  }
}
```

### 6.4 AgentRegistry 300ms 抗抖动

```typescript
claim(customerId: number, newWs: WebSocket, bootTime: number):
  { rejected: boolean; reason?: string } {
  const prev = this.map.get(customerId);

  if (prev && prev.bootTime === bootTime && Date.now() - prev.connectedAt < 300) {
    // 同一台机器 300ms 内重连，判断为网络抖动，拒绝新连
    return { rejected: true, reason: 'abort_newer_within_debounce' };
  }

  if (prev) {
    prev.ws.close(4001, 'replaced_by_newer_connection');
  }
  this.map.set(customerId, { ws: newWs, bootTime, connectedAt: Date.now() });
  return { rejected: false };
}
```

### 6.5 心跳去抖 DB 写

```typescript
// 同一 licenseId 的 heartbeat 30s 内只 UPDATE 一次（防客户端 bug 刷 DB）
private lastHbWrite = new Map<number, number>();

async updateHeartbeat(licenseId: number, hb: HeartbeatDto) {
  const now = Date.now();
  const last = this.lastHbWrite.get(licenseId) ?? 0;
  if (now - last < 20_000) return;  // 20s 内不重复写
  this.lastHbWrite.set(licenseId, now);

  await this.pool.query(`
    UPDATE agents SET
      last_heartbeat_at = now(),
      uptime_seconds = $1, cpu_percent = $2,
      mem_used_mb = $3, mem_total_mb = $4, loadavg_1 = $5,
      updated_at = now()
    WHERE license_id = $6 AND deleted_at IS NULL
  `, [hb.uptime_seconds, hb.cpu_percent, hb.mem_used_mb, hb.mem_total_mb, hb.loadavg_1, licenseId]);
}
```

### 6.6 离线检测 cron

```typescript
@Cron('*/30 * * * * *')
async detectOffline() {
  await this.pool.query(`
    UPDATE agents SET status='offline', disconnected_at=now()
    WHERE status='online'
      AND last_heartbeat_at < now() - interval '90 seconds'
      AND deleted_at IS NULL
  `);
}
```

---

## 7. Go agent 架构

### 7.1 代码结构

```
go-agent/
├── go.mod                           module energybot/agent, go 1.26
├── cmd/
│   └── agent/
│       └── main.go                  -- 入口：flag 解析、配置加载、启动 run loop
├── internal/
│   ├── config/config.go             -- 读 /etc/energybot/license.conf + env 覆盖
│   ├── auth/signer.go               -- HMAC-SHA256 签名 + headers 构造
│   ├── client/
│   │   ├── client.go                -- wss 连接管理 + reconnect + exponential backoff
│   │   ├── heartbeat.go             -- 心跳 goroutine
│   │   └── sysinfo.go               -- gopsutil 采集
│   ├── jsonrpc/jsonrpc.go
│   └── log/log.go
├── packaging/
│   ├── systemd/energybot-agent.service
│   └── build.sh                     -- 交叉编译 amd64 + arm64
└── README.md
```

### 7.2 依赖

```
github.com/gorilla/websocket  v1.5.x
github.com/shirou/gopsutil/v4 v4.x
go.uber.org/zap               v1.27.x
```

### 7.3 连接 run loop 状态机

```go
func (c *Client) Run(ctx context.Context) error {
    backoff := newBackoff(time.Second, 300*time.Second, 2.0)
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        default:
        }

        conn, err := c.dial(ctx)
        if err != nil {
            c.log.Warn("dial failed", zap.Error(err))
            select {
            case <-ctx.Done(): return ctx.Err()
            case <-time.After(backoff.Next()):
            }
            continue
        }

        ackInterval, err := c.handshake(ctx, conn)
        if err != nil {
            conn.Close()
            if isFatalClose(err) { return err }  // 4001 / 4003
            continue
        }

        backoff.Reset()

        readErr := c.serve(ctx, conn, ackInterval)
        conn.Close()

        if isFatalClose(readErr) {
            return readErr
        }
        c.log.Info("disconnected, will reconnect", zap.Error(readErr))
    }
}
```

### 7.4 sysinfo 采集

```go
// 用 gopsutil 统一跨环境采集
func CollectHeartbeat() Heartbeat {
    uptime, _ := host.Uptime()
    cpuPct, _ := cpu.Percent(200*time.Millisecond, false)  // false=平均值
    vm, _    := mem.VirtualMemory()
    loads, _ := load.Avg()
    return Heartbeat{
        UptimeSeconds: int64(uptime),
        CpuPercent:    round2(cpuPct[0]),
        MemUsedMb:     int(vm.Used / 1024 / 1024),
        MemTotalMb:    int(vm.Total / 1024 / 1024),
        Loadavg1:      round2(loads.Load1),
    }
}
```

### 7.5 配置来源

```go
// 三级优先：flag > env > /etc/energybot/license.conf

type Config struct {
    LicenseKey    string  // ENV: LICENSE_KEY / flag: --license-key
    LicenseSecret string  // ENV: LICENSE_SECRET / flag: --license-secret
    Server        string  // ENV: AGENT_SERVER / flag: --server, 默认 wss://www.feiyijt.com/agent
    LogLevel      string  // ENV: AGENT_LOG_LEVEL / flag: --log-level, 默认 info
}
```

### 7.6 Exit code 约定

| exit code | 含义 | systemd 是否重启 |
|---|---|---|
| 0 | 正常结束（ctx 取消，极少发生） | 否 |
| 1 | 运行时错误，允许重启 | 是 |
| 42 | license 吊销或被后来者替换 | 否（RestartPreventExitStatus=42） |

### 7.7 本地开发调试

```bash
cd go-agent
go run ./cmd/agent \
  --license-key=ebt_<your-test-license-key> \
  --license-secret=<your-test-license-secret> \
  --server=ws://localhost:3001/agent \
  --log-level=debug
```

### 7.8 生产 build

```bash
# packaging/build.sh
#!/bin/sh
set -eu
VERSION="${VERSION:-0.1.0}"
LDFLAGS="-s -w -X main.version=${VERSION}"
for ARCH in amd64 arm64; do
    CGO_ENABLED=0 GOOS=linux GOARCH="$ARCH" \
        go build -trimpath -ldflags="$LDFLAGS" \
        -o "dist/energybot-agent-linux-${ARCH}" \
        ./cmd/agent
    echo "built: dist/energybot-agent-linux-${ARCH}"
done
```

预估二进制体积：**2-3 MB**（无 pgx / gotron-sdk / grpc / protobuf，极简依赖）。

---

## 8. install.sh 改造

### 8.1 新增 install_agent() 函数

在现有 "License 写入" 成功后追加：

```sh
install_agent() {
    log_info "安装 energybot-agent..."

    local arch
    arch=$(uname -m)
    case "$arch" in
        x86_64)  arch=amd64 ;;
        aarch64) arch=arm64 ;;
        *)       log_fatal "不支持的架构: $arch" ;;
    esac

    local bin_url="https://www.feiyijt.com/bin/energybot-agent-linux-${arch}"
    local unit_url="https://www.feiyijt.com/systemd/energybot-agent.service"

    if ! curl -fsSL "$bin_url" -o /tmp/energybot-agent; then
        log_fatal "下载 agent 二进制失败：$bin_url"
    fi
    chmod +x /tmp/energybot-agent
    mv /tmp/energybot-agent /usr/local/bin/energybot-agent

    if ! curl -fsSL "$unit_url" -o /etc/systemd/system/energybot-agent.service; then
        log_fatal "下载 systemd unit 失败：$unit_url"
    fi

    systemctl daemon-reload
    systemctl enable --now energybot-agent

    sleep 3

    if systemctl is-active --quiet energybot-agent; then
        log_info "energybot-agent 已启动（PID: $(systemctl show -p MainPID --value energybot-agent)）"
    else
        log_warn "agent 启动异常，请查看：journalctl -u energybot-agent -n 50 --no-pager"
    fi
}
```

### 8.2 VERIFY_ONLY 模式保持不变

`VERIFY_ONLY=1` 时只 precheck，不装 agent（原行为不变）。

### 8.3 幂等语义

- 重跑 install.sh：检测到 agent 已装（systemd unit 存在 + 二进制 mtime < 24h），跳过下载，只 `systemctl restart`。
- 检测到二进制 mtime > 24h：重新下载（自动升级路径）。

---

## 9. systemd unit

```ini
[Unit]
Description=EnergyBot Agent
Documentation=https://www.feiyijt.com/
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
EnvironmentFile=/etc/energybot/license.conf
ExecStart=/usr/local/bin/energybot-agent \
    --license-key=${LICENSE_KEY} \
    --license-secret=${LICENSE_SECRET} \
    --server=wss://www.feiyijt.com/agent

Restart=always
RestartSec=5s
RestartPreventExitStatus=42

StandardOutput=journal
StandardError=journal

# 资源限制
LimitNOFILE=8192
MemoryMax=128M
CPUQuota=50%

[Install]
WantedBy=multi-user.target
```

**`license.conf` 的 shell 变量展开兼容性**：install.sh 写入的 `license.conf` 格式必须是 `KEY=VALUE`（无引号），systemd `EnvironmentFile` 才能正确读取。子系统 A 的 install.sh 已经是这个格式，兼容。

---

## 10. nginx 配置新增

```nginx
# /opt/maer-energy/current/nginx/conf.d/feiyijt.conf (在现有 server 块内新增 location)

location /agent {
    proxy_pass http://maer-energy-api:3001/agent;
    proxy_http_version 1.1;

    # WebSocket upgrade
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    # 传递握手 headers
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_set_header X-License-Key     $http_x_license_key;
    proxy_set_header X-Timestamp       $http_x_timestamp;
    proxy_set_header X-Nonce           $http_x_nonce;
    proxy_set_header X-Agent-Version   $http_x_agent_version;
    proxy_set_header X-Signature       $http_x_signature;

    # WS 长连接
    proxy_read_timeout  3600s;
    proxy_send_timeout  3600s;
    proxy_buffering     off;
}
```

### 10.1 Cloudflare 前置层

- CF Network → WebSockets **必须 on**（Free plan 默认 on）。
- CF Free plan 限制 **每源站 100 并发 WebSocket**。MVP 阶段用不完。
- 监控项：当 `agents WHERE status='online'` 数量 > 80 时，在 plan 里提示升级 CF Pro。
- CF Free 对 WebSocket 无单连接时长限制（不像 TCP proxy 模式）。

---

## 11. 前端「我的 Bot」页 v0.1

### 11.1 路由与菜单

- 菜单项：`账户中心 → 我的 Bot`（`/account/my-bot`），紧挨现有 `我的 License`
- 菜单 code: `default:account:my-bot`
- 权限：role 1/2/3 均可见

### 11.2 UI 结构

```
┌─────────────────────────────────────────────────┐
│  我的 Bot                                        │
├─────────────────────────────────────────────────┤
│                                                 │
│   🟢 在线   |   最后心跳：刚刚 （10s poll）      │
│                                                 │
│   主机信息:                                      │
│     主机名:    customer-srv-01                   │
│     系统:     Linux 6.8.0-1024-aws x86_64       │
│     Agent:    v0.1.0                            │
│     公网 IP:  203.0.113.42                       │
│                                                 │
│   资源使用:                                      │
│     CPU:     5.2%                               │
│     内存:    1024 MB / 8192 MB  (12.5%)         │
│     运行:    1 小时 0 分                         │
│                                                 │
│   [ 查看 agent 日志指南 ]  [ 手动刷新 ]           │
│                                                 │
└─────────────────────────────────────────────────┘
```

离线态：

```
┌─────────────────────────────────────────────────┐
│  ⚫ 离线   |   最后心跳：2 分钟前                 │
│                                                 │
│  可能的排查：                                     │
│    1. SSH 到你的服务器执行：                      │
│       systemctl status energybot-agent          │
│    2. 查看日志：                                  │
│       journalctl -u energybot-agent -n 100     │
│    3. 如果 license 已吊销，联系管理员             │
└─────────────────────────────────────────────────┘
```

从未注册态（客户装了 license 但还没跑 agent）：

```
┌─────────────────────────────────────────────────┐
│  ⚪ 未部署                                        │
│  你的 license 已颁发但 agent 还没连接过控制台。   │
│  请在你的服务器上运行 install.sh：               │
│  [ 复制安装命令 ]                                │
└─────────────────────────────────────────────────┘
```

### 11.3 前端组件

```
ui/src/app/pages/account/my-bot/
├── my-bot.component.ts       -- 主容器 + 定时 poll
├── my-bot.component.html
├── my-bot.component.less
├── my-bot.routes.ts
└── services/
    └── my-bot.service.ts     -- HTTP 客户端
```

POLL 间隔：**10 秒**（用户主动开着页面时才 poll；离开页面暂停）。

---

## 12. API 端点

### 12.1 GET /default/account/my-bot/status

**鉴权**：JwtGuard + AuthGuard + `@Permission('default:account:my-bot')`

**响应**：
```jsonc
// agent 已连过
{ "state": "online" | "offline",
  "agent_id": 42,
  "agent_version": "0.1.0",
  "host_name": "customer-srv-01",
  "os_info": "Linux ...",
  "public_ip": "203.0.113.42",
  "connected_at": "2026-05-04T10:00:00Z",
  "last_heartbeat_at": "2026-05-04T10:01:30Z",
  "disconnected_at": null,
  "uptime_seconds": 3600,
  "cpu_percent": 5.2,
  "mem_used_mb": 1024,
  "mem_total_mb": 8192,
  "loadavg_1": 0.31
}

// agent 未部署
{ "state": "not_deployed",
  "install_command": "curl -fsSL https://www.feiyijt.com/install.sh | LICENSE_KEY=... LICENSE_SECRET=... sh"
}
```

查询实现：按当前登录 user 的 `customer_id` 查 `agents` 和 `licenses` 两表。

---

## 13. 测试策略

### 13.1 单测

- **nest-api 单测（jest）**：
  - `agent.service.spec.ts`：upsertOnConnect、markOffline、心跳去抖、公网 IP 提取
  - `agent-registry.service.spec.ts`：后来者赢、300ms 抗抖、bootTime 判等
  - `jsonrpc.util.spec.ts`：encode/decode、各错误码构造
- **go-agent 单测（go test）**：
  - `internal/auth/signer_test.go`：HMAC 签名结果
  - `internal/client/client_test.go`：backoff 数列、状态机转移
  - `internal/jsonrpc/jsonrpc_test.go`：编解码
- **跨端 HMAC fixture 互测**：新文件 `test/fixtures/hmac-pairs.json` 含 10 组 `{key, secret, method, path, ts, nonce, body}` → `expected_signature`。nest-api 和 go-agent 的签名单测都读这个 fixture，保证跨语言一致。

### 13.2 E2E

新文件 `nest-api/test/agent-gateway.e2e-spec.ts`：

```typescript
describe('AgentGateway (e2e)', () => {
  // 起 NestJS 应用 + 用 'ws' 库作客户端
  it('成功握手 + 收到 hello.ack');
  it('签名错误 → close 4003');
  it('时间戳超窗 → close 4013');
  it('nonce 重放 → close 4013');
  it('license 不存在 → close 4003');
  it('license 吊销 → close 4003');
  it('并发两连接：新连被接受，旧连收到 close 4001');
  it('300ms 内同 bootTime 重连：新连被 close 4013');
  it('心跳写 DB 去抖：30s 内 5 次心跳，只 UPDATE 1 次');
});
```

### 13.3 真机冒烟（43.119.5.98）

| 步骤 | 期望 |
|---|---|
| `curl ... \| LICENSE_KEY=... LICENSE_SECRET=... sh` | agent 安装 + systemd enable + journal 看到 "connected, agent_id=..." |
| 登录控制台 `/account/my-bot` | 🟢 在线 + 心跳数据显示 |
| `systemctl restart energybot-agent` | 控制台 3-5s 内：🟢 → ⚫ → 🟢 |
| `systemctl stop energybot-agent` | 90s 内变 ⚫，排查提示显示 |
| 管理员吊销该 license | agent journal 记 "license_revoked, exit 42"；systemd 不重启 |
| 管理员重新 issue license → 客户重跑 install.sh | agent 正常回上线 |
| 同 license 在另一机器装（模拟客户手滑装错） | 原机器 journal 记 "replaced_by_newer, exit 42"；控制台恒定显示最新连的那台 |

### 13.4 回归基线

- 既有 219 jest pass / 2 基线失败（`energy-rental.service.spec.ts`）：不动
- karma 262+X 全绿
- Go：B1 新增模块全绿，不动 `go-bot`

---

## 14. 部署方案

### 14.1 部署顺序

1. **本地构建 + 推送 feature 分支**：`feature/subsystem-b1-wss-channel`。
2. **CI 过（或手动 lint+test+build 全绿）**。
3. **生产 DB migration**：`psql $DB_URL -f nest-api/sql/20260504-agents-table.sql`。
4. **API build**：`cd nest-api && npm run build` → `rsync dist/ root@prod:/opt/maer-energy/current/api/dist/`。
5. **Docker compose build + up**：`docker compose -p maer-energy build api && docker compose -p maer-energy up -d --force-recreate api`。
6. **UI build + rsync**（包含我的 Bot 页）：`npx ng build --configuration=production` → rsync。
7. **nginx conf 更新** `/opt/maer-energy/current/nginx/conf.d/feiyijt.conf`（在 cardshop-app 容器内）→ `docker exec cardshop-app nginx -s reload`。
8. **Agent 二进制交付**：本地 `cd go-agent && packaging/build.sh` → `rsync dist/*.bin root@prod:/opt/maer-energy/public/bin/`。
9. **systemd unit 上传**：rsync `go-agent/packaging/systemd/energybot-agent.service` → `/opt/maer-energy/public/systemd/`。
10. **install.sh 更新**：rsync `scripts/install.sh` → `/opt/maer-energy/public/install.sh`。
11. **验收**：43.119.5.98 机器上重跑 install.sh → 等 10 秒 → 生产控制台 `/account/my-bot` 确认 🟢。

### 14.2 回滚方案

- **API 回滚**：`cd /opt/maer-energy && ln -sfn releases/<prev>/api current/api && docker compose -p maer-energy up -d --force-recreate api`。
- **UI 回滚**：同上，切 symlink。
- **DB 回滚**：`psql $DB_URL -f 20260504-agents-table.rollback.sql`。
- **install.sh 回滚**：保留 `install.sh.pre-b1` 备份，`mv` 即可。
- **Agent 清理**：客户侧 `systemctl disable --now energybot-agent && rm /usr/local/bin/energybot-agent /etc/systemd/system/energybot-agent.service`。

### 14.3 监控

B1 阶段最小集合：

- **生产 PostgreSQL 查询**：手动查 `SELECT status, COUNT(*) FROM agents GROUP BY status`。
- **NestJS journal 日志**：connect/disconnect/sign_fail 三类事件 `logger.log('agent.connect', { licenseKey })`。
- **CF WebSocket 用量**：CF dashboard 每周一次人工查。

B2 阶段可视化。

---

## 15. 工作量拆分

| Phase | 任务 | 工时 | 验收 |
|---|---|---|---|
| P1 | DB migration + AgentModule 骨架 + JSON-RPC util + 单测 | 0.5 天 | `npm test` 增量全绿 |
| P2 | AgentGateway（handleConnection + 签名验证 + registry）+ e2e | 1 天 | e2e 所有场景 pass |
| P3 | Go agent（config/auth/client/heartbeat）+ 单测 + HMAC fixture 互测 | 1 天 | `go test ./...` 全绿 + 本地对接 nest dev 握手成功 |
| P4 | UI「我的 Bot」页 + API status 端点 | 0.5 天 | 本地能 offline/online 切换显示 |
| P5 | install.sh 改造 + build.sh + systemd unit + packaging | 0.5 天 | 本地 VM 验证全流程 |
| P6 | 生产部署 + 真机 e2e + 冒烟 | 0.5 天 | 43.119.5.98 绿灯 |
| P7 | 文档（acceptance.md）+ commit + PR 描述 | 0.5 天 | PR 代码审查 checklist 完成 |
| **合计** | | **4.5 天** | |

---

## 16. 非目标（B1 不做的事）

以下明确推到 B2 / B3 / 未来：

- **控制台 → agent 的主动 RPC**（重启 bot、查询业务状态、推送配置）→ B2
- **配置 schema 与落 SQLite**（bot token、文案、按钮菜单）→ B2
- **go-bot 代码迁移到 agent 进程内 spawn**（pgx→SQLite、botruntime 重构、私钥加密、硬编码 URL 可配置）→ B3
- **Telegram bot 端到端跑通**（agent 真实 spawn + 用户在 TG 里点按钮能下单）→ B3
- **agent 自动升级** → 未来（B1 仅支持通过重跑 install.sh 升级）
- **多 agent / license** → 未来（B1 strict 一 license 一 agent）
- **心跳历史时序曲线** → 未来（B1 只存最后一次心跳）
- **CF Pro 升级** → 未来（等 online agents 数量逼近 CF Free 的 100 并发上限）

---

## 17. 风险与假设

### 17.1 风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| Cloudflare Free plan WebSocket 帧奇怪兼容问题 | 低 | 高 | 在真机冒烟 P6 单独测 CF 代理下的 wss 稳定 15 分钟 |
| 客户防火墙禁 443 出站或拦 WebSocket | 中 | 中 | install.sh 跑完前做一次 ws 拨测；失败给明确错误 |
| Go + Nest 两端 HMAC 实现微差 | 低 | 高 | fixture 互测 + 真机验证 |
| 客户时钟偏差 > 30s | 中 | 中 | close 4013 允许重连；install.sh 预检时可提示 NTP |
| 后来者赢语义被客户当 bug（客户投诉 "我装了两台怎么只看到一台"） | 中 | 低 | 控制台显示"当前活跃 agent" + 文档说明 |
| CPU/mem 采样在容器内不准 | 低 | 低 | 使用 gopsutil v4 自动处理 cgroup；文档注明 |

### 17.2 假设

- 客户服务器可访问 `www.feiyijt.com:443`（子系统 A 装完已验证）。
- 客户 Linux 发行版 systemd 工作正常（install.sh 已有 precheck）。
- CF 免费 plan 100 并发 WebSocket 在 MVP 阶段足够。
- 客户不自改 `/etc/energybot/license.conf`。
- agents 表后续 B2/B3 迁移策略："append 列而非拆表"。

---

## 18. 后续工作（B2 / B3 预告）

B1 合并上线后，下一份规格文档 `2026-??-??-subsystem-b2-config-dispatch-design.md` 覆盖：

- 新表 `bot_configs`（tg_token AES-GCM 加密、文案模板、按钮菜单 JSON）
- 控制台「我的 Bot」页扩展为多 tab（基础配置 / 文案 / 按钮 / 日志）
- NestJS 新 RPC `agent.apply_config` 调用端（server → agent）
- Agent 侧 SQLite schema + `rpc.handleApplyConfig` 落盘
- 控制台保存配置 → 下发 RPC → agent ack → UI 提示「已推送到你的服务器」

B3 规格（单独出）覆盖 go-bot 迁移完整方案，包括 PostgreSQL→SQLite SQL 方言改写清单、botruntime 重构、私钥加密、TRON gRPC 端点可配置化、实际 Telegram bot spawn、TRON 测试网端到端。

---

**规格结束**。

基于 2026-05-04 对 go-bot/internal/ 9,139 行代码的 very-thorough 调研，本规格的工时估算 4.5 天置信度高。B1 本身不涉及 go-bot 重构，技术不确定性主要在 NestJS WebSocket 与 Go gorilla/websocket 跨端握手的联调——这属于可通过 fixture 互测提前收敛的风险。
