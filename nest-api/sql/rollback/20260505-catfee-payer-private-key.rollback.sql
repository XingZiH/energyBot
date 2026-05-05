-- 回滚 20260505-catfee-payer-private-key.sql
--
-- 警告：会丢失 catfee_payer_private_key 列存储的加密私钥；回滚后需重新录入。
--
-- 回滚前提：
--   - nest-api 已回滚到未使用 catfeePayerPrivateKey 的版本（T11.10 前）
--   - 客户端 bot 版本可容忍 platformReceiveAddress 为空（即 catfee 模式不启动 bot）

BEGIN;

ALTER TABLE public.energy_platform_config
  DROP COLUMN IF EXISTS catfee_payer_private_key;

COMMIT;
