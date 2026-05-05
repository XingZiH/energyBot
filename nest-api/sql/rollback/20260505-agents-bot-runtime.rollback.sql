-- 回滚 20260505-agents-bot-runtime.sql
-- 删除 agents 表的 bot_* 字段及索引

BEGIN;

DROP INDEX IF EXISTS public.idx_agents_bot_status;

ALTER TABLE public.agents
  DROP COLUMN IF EXISTS bot_last_error,
  DROP COLUMN IF EXISTS bot_last_tg_poll_at,
  DROP COLUMN IF EXISTS bot_config_version,
  DROP COLUMN IF EXISTS bot_uptime_seconds,
  DROP COLUMN IF EXISTS bot_pid,
  DROP COLUMN IF EXISTS bot_status;

COMMIT;
