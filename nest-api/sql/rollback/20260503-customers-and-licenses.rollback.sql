-- 回滚 20260503-customers-and-licenses.sql
--
-- 撤销 customers / licenses 两张表和客户管理菜单 + 5 条权限。
-- 注意：回滚会丢失所有已颁发 license 的记录——若生产已上线客户，先备份 public.licenses 再执行。

BEGIN;

-- 撤销权限
DELETE FROM public.sys_role_perm
WHERE perm_code IN (
  'default:system:customers',
  'default:system:customers:add',
  'default:system:customers:edit',
  'default:system:customers:revoke',
  'default:system:customers:reveal'
);

-- 撤销菜单（先 F，再 C）
DELETE FROM public.menu
WHERE code IN (
  'default:system:customers:add',
  'default:system:customers:edit',
  'default:system:customers:revoke',
  'default:system:customers:reveal'
);

DELETE FROM public.menu
WHERE code = 'default:system:customers';

-- 撤销表
DROP TABLE IF EXISTS public.licenses;
DROP TABLE IF EXISTS public.customers;

COMMIT;
