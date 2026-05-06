-- B3-T12: 彻底拆除 JustLend，引入 platform_receive_address
-- 幂等：所有 DROP 用 IF EXISTS，ADD COLUMN 用 IF NOT EXISTS
-- 回滚脚本：sql/rollback/20260506-t12-drop-justlend.rollback.sql

BEGIN;

-- 1. energy_platform_config 表
--    a) 新增平台统一收款地址（TRON 地址字符串，运营手填）
ALTER TABLE public.energy_platform_config
  ADD COLUMN IF NOT EXISTS platform_receive_address TEXT;
COMMENT ON COLUMN public.energy_platform_config.platform_receive_address IS
  'T12：平台统一收款地址（TRON Base58 地址），用户付款入账地址；下发给 bot 用于对账';

--    b) 删除 justlend 字段（不再使用 justlend 供应商）
ALTER TABLE public.energy_platform_config
  DROP COLUMN IF EXISTS justlend_contract_address,
  DROP COLUMN IF EXISTS justlend_payer_private_key;

--    c) 删除 T11.11 的 catfee_payer_private_key
--       （T12 架构变更：不再由后端派生地址，改由运营在 platform_receive_address 手填）
ALTER TABLE public.energy_platform_config
  DROP COLUMN IF EXISTS catfee_payer_private_key;

--    d) 删除 energy_provider 字段（单 provider 架构）
ALTER TABLE public.energy_platform_config
  DROP COLUMN IF EXISTS energy_provider;

-- 2. energy_orders 表
--    删除 energy_provider 字段（历史订单数据 accept loss，一次性切换）
ALTER TABLE public.energy_orders
  DROP COLUMN IF EXISTS energy_provider;

COMMIT;
