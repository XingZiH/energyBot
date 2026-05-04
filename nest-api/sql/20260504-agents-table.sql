-- 子系统 B1：WSS agent 反向通道 - agents 表 migration
--
-- 背景：客户端 VPS 上运行的 energybot agent 通过 WSS 反向连回服务端，
--       服务端对每个 license 持一个 agent 会话；握手时 upsert agents 行，
--       心跳(20s 间隔，服务端去抖写入)刷新主机 metrics，
--       OfflineScheduler 每 30s 扫描 last_heartbeat_at 超过 90s 的行置 offline。
--
-- 本 migration：
--   1) 建立 public.agents 表，UNIQUE(license_id)：一 license 对应至多一个 agent 行
--   2) 新增顶层菜单「我的 Bot」C 型
--      （path: /default/account/my-bot, code: default:account:my-bot）
--   3) 给所有现有 role 授予菜单权限码（本期页面只读，不新增 F 型按钮权限）
--
-- 表字段说明：
--   - status 三态：
--       * never_seen —— 从未握手过（license 刚发放，客户还没部署）
--       * online     —— 当前 WS 会话存活且最近心跳在 90s 内
--       * offline    —— 曾经上线但 90s 未心跳（Scheduler 置位）或主动断开
--   - boot_time：agent 进程自身启动时刻，用于识别"断线重连 vs 重启"
--   - connected_at：本次 WS 连接建立时刻（握手成功时写入）
--   - last_heartbeat_at：最近一次心跳到达时刻，去抖后写入
--   - uptime_seconds / cpu_percent / mem_used_bytes / mem_total_bytes / loadavg_1：
--       心跳上报的 5 个主机 metrics，页面直接展示
--
-- 权限码约定：
--   - default:account:my-bot   C 菜单，进入"我的 Bot"页面（所有登录用户都应有）
--
-- 关联：
--   - nest-api/src/drizzle/schema.ts 中的 agentsTable Drizzle 定义
--   - nest-api/src/modules/agent/ —— WSS Gateway + 握手/心跳/Offline 服务
--   - 前端 ui/src/app/pages/account/my-bot/ —— 只读展示 agent 状态
--   - 回滚脚本：sql/rollback/20260504-agents-table.rollback.sql
--
-- 上线步骤：
--   1. psql $DATABASE_URL -f 20260504-agents-table.sql
--   2. 重启 nest-api（加载 WSS Gateway + OfflineScheduler）
--   3. 部署 / 升级客户端 agent 二进制（兼容 B1 握手协议）
--   4. 前端重新 build 发布（露出"我的 Bot"菜单）
--   5. 若需回滚：psql $DATABASE_URL -f rollback/20260504-agents-table.rollback.sql

BEGIN;

-- ----------------------------------------------------------------------------
-- agents：一个 license 至多对应一个 agent 行（UNIQUE(license_id)）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agents (
    id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    license_id         INTEGER       NOT NULL UNIQUE REFERENCES public.licenses(id),
    customer_id        INTEGER       NOT NULL REFERENCES public.customers(id),
    status             VARCHAR(16)   NOT NULL DEFAULT 'never_seen', -- online | offline | never_seen
    agent_version      VARCHAR(32),                                 -- semver，握手时填
    public_ip          VARCHAR(64),                                 -- 由 X-Forwarded-For / remoteAddress 取（v4/v6 字符串）
    host_name          VARCHAR(120),
    kernel             VARCHAR(120),
    boot_time          TIMESTAMP,                                   -- agent 进程启动时刻
    connected_at       TIMESTAMP,                                   -- 本次 WS 握手建立时刻
    last_heartbeat_at  TIMESTAMP,                                   -- 最近心跳到达时刻（去抖后）
    uptime_seconds     BIGINT,                                      -- 主机 uptime
    cpu_percent        NUMERIC(5, 2),                               -- 0-100
    mem_used_bytes     BIGINT,
    mem_total_bytes    BIGINT,
    loadavg_1          NUMERIC(6, 2),
    updated_at         TIMESTAMP,
    created_at         TIMESTAMP     NOT NULL DEFAULT now(),
    deleted_at         TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agents_customer_id
  ON public.agents (customer_id);

-- 只索引 online / offline 两态（never_seen 占大头且列表不查它）
CREATE INDEX IF NOT EXISTS idx_agents_status
  ON public.agents (status)
  WHERE status <> 'never_seen';

-- ----------------------------------------------------------------------------
-- 菜单：顶层「我的 Bot」C 型（father_id=0，排在「我的 License」order_num=200 之后）
-- ----------------------------------------------------------------------------
INSERT INTO public.menu (
  father_id, menu_name, menu_type, al_icon, icon, path, code, order_num, status, new_link_flag, visible
)
SELECT 0,
       U&'\6211\7684 Bot',                          -- "我的 Bot"
       'C', NULL, 'robot',
       '/default/account/my-bot',
       'default:account:my-bot',
       210, true, false, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.menu m WHERE m.code = 'default:account:my-bot'
);

-- ----------------------------------------------------------------------------
-- 授权：所有现有 role 都授予「我的 Bot」菜单权限
--   本期页面只读展示 agent 状态 + 主机 metrics，无敏感按钮，故不引入 F 型子权限
-- ----------------------------------------------------------------------------
INSERT INTO public.sys_role_perm (role_id, perm_code)
SELECT r.id, 'default:account:my-bot'
FROM public.role r
WHERE NOT EXISTS (
  SELECT 1
  FROM public.sys_role_perm rp
  WHERE rp.role_id = r.id AND rp.perm_code = 'default:account:my-bot'
);

COMMIT;
