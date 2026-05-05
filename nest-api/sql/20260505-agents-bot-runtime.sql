-- 子系统 B3：agents 表新增 bot 运行时字段
--
-- 背景：B3 让客户机 agent supervisor spawn 一个 energybot-bot 子进程，
--       通过心跳上报 bot 的运行状态。go-agent 心跳协议从 B3-T3 起，
--       params 可携带可选 bot 对象（status/pid/uptime_seconds/config_version/
--       last_tg_poll_at/last_error），由 nest-api 落库。
--
-- 本 migration：
--   给 public.agents 表新增 6 个 bot_* 字段；全部允许 NULL，对存量行无影响。
--   旧版 agent（不上报 bot 字段）继续工作，仅 bot_* 列保持为 NULL。
--
-- 字段语义：
--   - bot_status (varchar 16)：unknown | stopped | starting | running | error
--   - bot_pid (integer)：子进程 PID（running/error 时有值；stopped 时建议 NULL）
--   - bot_uptime_seconds (bigint)：bot 进程当前 uptime
--   - bot_config_version (varchar 64)：当前生效的 designer config hash 或版本号
--   - bot_last_tg_poll_at (timestamp)：最近一次成功的 Telegram getUpdates 时刻
--   - bot_last_error (varchar 500)：最近一次错误摘要（截断，便于前端展示）
--
-- 关联：
--   - go-agent/internal/botinfo/provider.go - BotInfo 字段定义（B3-T3）
--   - nest-api/src/drizzle/schema.ts - agentsTable Drizzle 定义（B3-T4）
--   - nest-api/src/modules/agent/agent.service.ts - updateHeartbeat 写入（B3-T4）
--   - 前端 ui/src/app/pages/account/my-bot/ - 展示 bot 状态（B3-T6 后续）
--   - 回滚脚本：sql/rollback/20260505-agents-bot-runtime.rollback.sql
--
-- 上线步骤：
--   1. psql $DATABASE_URL -f 20260505-agents-bot-runtime.sql
--   2. 重启 nest-api（加载新 schema）
--   3. 升级客户端 agent 到 B3 版本（带 bot 字段）
--   4. 若需回滚：psql $DATABASE_URL -f rollback/20260505-agents-bot-runtime.rollback.sql

BEGIN;

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS bot_status            VARCHAR(16),
  ADD COLUMN IF NOT EXISTS bot_pid               INTEGER,
  ADD COLUMN IF NOT EXISTS bot_uptime_seconds    BIGINT,
  ADD COLUMN IF NOT EXISTS bot_config_version    VARCHAR(64),
  ADD COLUMN IF NOT EXISTS bot_last_tg_poll_at   TIMESTAMP,
  ADD COLUMN IF NOT EXISTS bot_last_error        VARCHAR(500);

-- 仅索引活跃状态（running/error），其它低基数无需索引
CREATE INDEX IF NOT EXISTS idx_agents_bot_status
  ON public.agents (bot_status)
  WHERE bot_status IN ('running', 'error');

COMMIT;
