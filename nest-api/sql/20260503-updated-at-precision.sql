-- 修复乐观锁 409 恒失败的根因：agent_bot_configs.updated_at 精度与 JS Date 不匹配。
--
-- 症状：前端 GET 拿到 updatedAt='2026-05-03T05:28:40.493Z'（毫秒），
--       原样回传到 PUT 的 If-Unmodified-Since，后端 new Date() 得到毫秒精度 Date，
--       drizzle 生成 SQL `WHERE updated_at = '2026-05-03 05:28:40.493'`，
--       与 DB 里实际存的 '.493975'（微秒精度）匹配失败 → affected rows=0 → 抛 409
--       "配置已被他人修改"。
--
-- 根源：Postgres `timestamp` 列默认精度为 6（微秒），now() 返回微秒时间。
--       JavaScript Date 只有毫秒精度（ECMA-262），导致 JS 读出来的时间永远丢微秒位。
--       这使得「前端回传的 updatedAt 永远无法匹配 DB」，乐观锁形同失效。
--
-- 修复：把 updated_at 列精度降到 timestamp(3)（毫秒），与 JS Date 对齐。
--       ALTER 会把历史微秒值截断为毫秒（.493975 → .493）。
--       今后 saveUiConfig 写入的 JS Date 也是毫秒，读写精度一致，乐观锁生效。
--
-- 影响范围：只改 agent_bot_configs.updated_at 一列。其他表的 updated_at 未参与乐观锁，
-- 继续用默认 timestamp(6) 不受影响。
--
-- 关联：ui-config.service.ts saveUiConfig 乐观锁 SQL；schema.ts agentBotConfigsTable。

BEGIN;

ALTER TABLE public.agent_bot_configs
  ALTER COLUMN updated_at TYPE timestamp(3);

COMMIT;
