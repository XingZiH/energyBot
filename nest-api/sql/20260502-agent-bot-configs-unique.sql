-- 加固 agent_bot_configs 表：agent_id 加 unique 约束，防止并发产生重复行。
-- 关联任务：任务 5 UI 配置 controller 代码审查（C1/M2 修复）。
--
-- 背景：saveUiConfig 原先是 select-then-insert，两次并发 PUT 会在
-- select 都返回空之后同时 insert，产生两条同 agent_id 的记录，
-- 导致后续 load 结果不稳定、乐观锁失效。
--
-- 修复方案：
--   1. 清理可能已存在的重复数据（保留 id 最小的行）
--   2. 建立部分 unique 索引（排除软删除行），便于 onConflict 原子 upsert
--   3. 修补 updated_at：补齐历史 null 值、加 DEFAULT now() 并置为 NOT NULL
--      （乐观锁基于 updated_at，null 会破坏 WHERE updated_at = expected 语义）

BEGIN;

-- 1) 清理可能存在的重复数据（保留 id 最小的行）
DELETE FROM public.agent_bot_configs a
USING public.agent_bot_configs b
WHERE a.agent_id = b.agent_id AND a.id > b.id;

-- 2) 添加 unique 索引（仅活跃行，软删除行之间允许同 agent_id）
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_bot_configs_agent_id
  ON public.agent_bot_configs (agent_id)
  WHERE deleted_at IS NULL;

-- 3) 修复 updated_at 应为 NOT NULL（乐观锁前置条件）
UPDATE public.agent_bot_configs
  SET updated_at = now()
  WHERE updated_at IS NULL;

ALTER TABLE public.agent_bot_configs
  ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE public.agent_bot_configs
  ALTER COLUMN updated_at SET NOT NULL;

COMMIT;
