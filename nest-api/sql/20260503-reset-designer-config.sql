-- 任务 12：重置 agent_bot_configs 所有 v1 designer 数据，v2 采用全新结构
--
-- 背景：
--   v1 的 menu_config 是平铺 JSON（无嵌套，按 packageId 索引），
--   message_config 是自由 key 的 map[string]string（noPackage/xxx 等）。
--   v2 的 menu_config 是嵌套 MenuRows（支持 submenu，最大深度 3，parseMenuRowsV2 严格校验），
--   message_config 是 MessageTemplates 强类型（9 个枚举字段：welcome/orderCreated/
--   payPending/paySuccess/payFailed/addressInvalid/unknownCommand/
--   packageUnavailable/walletQueryResult）。
--
-- 两套结构的 JSON schema 不兼容，生产上无法原位升级：
--   - 任何旧 menu_config 都会被 parseMenuRowsV2 拒绝（非法 JSON 或未知 action）
--   - 任何旧 message_config 的 key（如 "noPackage"）都会被 parseMessageTemplates 丢弃
--
-- 部署策略：
--   部署任务 12 代码时执行此脚本一次，清空所有 agent_bot_configs 的 3 个设计器字段。
--   清空后由管理员通过 WebUI（PR3 UI 阶段）重新配置。
--   保留 agent_id 绑定关系和 created_at 审计信息，只重置 3 个 v1 JSON 字段。

BEGIN;

UPDATE agent_bot_configs
SET
  welcome_text = '',
  menu_config = '[]',
  message_config = '{}',
  updated_at = now()
WHERE deleted_at IS NULL;

-- 记录清理统计，便于审计
DO $$
DECLARE
  affected_count integer;
BEGIN
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RAISE NOTICE '已重置 % 条 agent_bot_configs 记录为 v2 空结构', affected_count;
END $$;

COMMIT;
