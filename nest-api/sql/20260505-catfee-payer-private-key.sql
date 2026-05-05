-- 子系统 B3-T11.11：energy_platform_config 新增 catfee_payer_private_key 列
--
-- 背景：
--   catfee 模式的「平台收款地址」原本在 nest-api AgentApplyConfigService 里
--   被硬编码成空串下发给 agent/bot，导致 go-bot-v2 validateRuntimeConfig 的
--   PLATFORM_RECEIVE_ADDRESS required 校验失败，bot 进程启动即 exit 1，
--   前端「我的 Bot」页面看到 `exit: exit status 1 (code=1)`。
--
--   修复思路：与 justlend 模式对称，catfee 模式也存一个平台收款钱包私钥，
--   nest-api 下发配置时从该私钥派生 TRON 地址写入 platformReceiveAddress。
--
-- 本 migration：
--   给 public.energy_platform_config 表新增 1 个可空字段；对存量行无影响。
--   存量 catfee 部署在管理台补填此字段后即可启动 bot。
--
-- 字段语义：
--   - catfee_payer_private_key (text)：catfee 模式下平台收款地址的派生私钥，
--     与 justlend_payer_private_key 对称；nest-api 侧加密存储（setSecret）。
--
-- 关联：
--   - nest-api/src/drizzle/schema.ts - energyPlatformConfigTable 新增列
--   - nest-api/src/modules/agent/agent-apply-config.service.ts - catfee 分支派生地址
--   - nest-api/src/modules/energy-rental/energy-rental.service.ts - 写入/读取
--   - nest-api/src/modules/energy-rental/dto/energy-rental.dto.ts - DTO 字段
--   - 前端 ui/src/app/pages/energy-rental/platform-config/ - 录入 UI
--   - 回滚脚本：sql/rollback/20260505-catfee-payer-private-key.rollback.sql
--
-- 上线步骤：
--   1. psql $DATABASE_URL -f 20260505-catfee-payer-private-key.sql
--   2. 重启 nest-api（加载新 schema）
--   3. 管理台平台配置页录入 catfee 付款私钥并保存
--   4. 升级客户端 agent/bot 到 T11.10+ 版本
--   5. 若需回滚：psql $DATABASE_URL -f rollback/20260505-catfee-payer-private-key.rollback.sql

BEGIN;

ALTER TABLE public.energy_platform_config
  ADD COLUMN IF NOT EXISTS catfee_payer_private_key TEXT;

COMMENT ON COLUMN public.energy_platform_config.catfee_payer_private_key IS
  'catfee 模式下平台收款地址的派生私钥（加密存储，与 justlend_payer_private_key 对称）';

COMMIT;
