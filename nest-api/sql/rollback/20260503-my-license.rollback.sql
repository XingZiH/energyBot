-- 回滚：20260503-my-license.sql
-- 删除「我的 License」菜单、权限授予、user.customer_id 列
--
-- 注意：回滚前应当确认：
--   1. 没有活跃客户账号绑定在 user.customer_id 上（否则这些用户将丢失 license 查询能力）
--   2. 前端已移除 /default/account/my-license 路由链接

BEGIN;

-- 先撤销 role 授权
DELETE FROM public.sys_role_perm
WHERE perm_code IN (
  'default:account:my-license',
  'default:account:my-license:reveal'
);

-- 删 F 型子菜单
DELETE FROM public.menu
WHERE code = 'default:account:my-license:reveal';

-- 删 C 型顶层菜单
DELETE FROM public.menu
WHERE code = 'default:account:my-license';

-- 删 user.customer_id 列
DROP INDEX IF EXISTS idx_user_customer_id;
ALTER TABLE public."user" DROP COLUMN IF EXISTS customer_id;

COMMIT;
