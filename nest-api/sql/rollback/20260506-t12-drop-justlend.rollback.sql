-- 回滚 20260506-t12-drop-justlend.sql（T12：彻底拆除 JustLend，引入 platform_receive_address）
--
-- 警告：本回滚会尽力恢复被删除的列结构，但以下数据**不可恢复**：
--   - justlend_payer_private_key：加密存储的派生私钥，回滚后为 NULL
--   - catfee_payer_private_key：加密存储的派生私钥，回滚后为 NULL
--   - energy_provider（energy_platform_config / energy_orders 历史订单）：
--     回滚后全部为 DEFAULT 'justlend'，原始按订单区分的供应商信息已丢失
--   - platform_receive_address：T12 新增的运营手填地址，回滚后随列删除一并丢失
--
-- 回滚前提：
--   - nest-api 已回滚到 T11.11 或更早版本（仍使用 justlend / catfee 双 provider 架构）
--   - go-bot-v2 已回滚到 T11.11 或更早版本（仍依赖 energy_provider 字段决定调用路径）
--
-- 回滚后运营需做：
--   - 在管理台重新录入 justlend_payer_private_key 和 catfee_payer_private_key
--   - 校验/修正 energy_orders 的 energy_provider 默认值是否符合实际业务

BEGIN;

-- 恢复 energy_platform_config 列结构
ALTER TABLE public.energy_platform_config
  DROP COLUMN IF EXISTS platform_receive_address;

ALTER TABLE public.energy_platform_config
  ADD COLUMN IF NOT EXISTS justlend_contract_address VARCHAR(128),
  ADD COLUMN IF NOT EXISTS justlend_payer_private_key TEXT,
  ADD COLUMN IF NOT EXISTS catfee_payer_private_key TEXT,
  ADD COLUMN IF NOT EXISTS energy_provider VARCHAR(32) NOT NULL DEFAULT 'justlend';

-- 恢复 catfee_payer_private_key 的 COMMENT（T11.11 时代留下的，与 justlend_payer_private_key 对称）
COMMENT ON COLUMN public.energy_platform_config.catfee_payer_private_key IS
  'catfee 模式下平台收款地址的派生私钥（加密存储，与 justlend_payer_private_key 对称）';

-- 恢复 energy_orders.energy_provider
ALTER TABLE public.energy_orders
  ADD COLUMN IF NOT EXISTS energy_provider VARCHAR(32) NOT NULL DEFAULT 'justlend';

COMMIT;
