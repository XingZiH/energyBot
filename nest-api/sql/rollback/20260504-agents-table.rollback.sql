-- 回滚：20260504-agents-table.sql
-- 删除「我的 Bot」菜单、role 授权、agents 表（级联删索引）
--
-- 注意：回滚前应当确认：
--   1. 所有 WSS agent 会话已断开（停止 nest-api 或 disable AgentModule），否则在线会话仍会尝试写表导致报错
--   2. 前端已移除 /default/account/my-bot 路由链接
--   3. 本回滚会丢失所有 agent 心跳历史快照，不可恢复

BEGIN;

-- 先撤销 role 授权
DELETE FROM public.sys_role_perm
WHERE perm_code = 'default:account:my-bot';

-- 删菜单条目
DELETE FROM public.menu
WHERE code = 'default:account:my-bot';

-- 删表（一并级联删掉 idx_agents_customer_id / idx_agents_status 两个索引）
DROP TABLE IF EXISTS public.agents;

COMMIT;
