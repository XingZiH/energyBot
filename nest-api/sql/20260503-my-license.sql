-- 子系统 A：普通用户「我的 License」功能 migration
--
-- 背景：客户（终端用户）自己登录后应能在"个人中心 → 我的 License"里查看
--       自己这一份 license（key、状态、最近心跳、install 命令），但不能看到别人的。
--       管理员创建客户时可同时为该客户开一个登录账号并绑定到 customers 行。
--
-- 本 migration：
--   1) 给 public.user 加 customer_id 可空外键列（admin / 内部操作员为 NULL）
--   2) 新增顶层菜单「我的 License」C 型（path: /default/account/my-license, code: default:account:my-license）
--   3) 新增子 F 型权限 default:account:my-license:reveal（查看 secret / install 命令，默认授予）
--   4) 给所有现有 role（超管 1 / 普通用户 2 / 用户 3）授予上述两个 code
--
-- 权限码约定：
--   - default:account:my-license          C 菜单，进入"我的 License"页面（所有登录用户都应有）
--   - default:account:my-license:reveal   F 按钮，查看 licenseSecret 明文 + install 命令
--
-- 关联：
--   - nest-api/src/drizzle/schema.ts 中 userTable 同步加 customerId 字段
--   - nest-api 新增 MyLicenseController（GET /my-license, GET /my-license/install-command）
--   - CustomerService.create 接受可选 loginUserName / loginPassword，同事务创建 user 并绑定
--   - ui 新增页面 ui/src/app/pages/account/my-license/
--   - 回滚：sql/rollback/20260503-my-license.rollback.sql
--
-- 上线步骤：
--   1. psql 执行本脚本（BEGIN/COMMIT 包裹，失败自动回滚）
--   2. 重启 nest-api
--   3. 前端重新 build 发布

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) user 表加 customer_id（可空；仅普通用户绑定，admin / 内部操作员为 NULL）
-- ----------------------------------------------------------------------------
ALTER TABLE public."user"
  ADD COLUMN IF NOT EXISTS customer_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_user_customer_id
  ON public."user" (customer_id)
  WHERE customer_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2) 顶层菜单「我的 License」C 型（father_id=0，与"机器人控制""系统管理"并列）
-- ----------------------------------------------------------------------------
INSERT INTO public.menu (
  father_id, menu_name, menu_type, al_icon, icon, path, code, order_num, status, new_link_flag, visible
)
SELECT 0,
       U&'\6211\7684 License',                     -- "我的 License"
       'C', NULL, 'key',
       '/default/account/my-license',
       'default:account:my-license',
       200, true, false, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.menu m WHERE m.code = 'default:account:my-license'
);

-- 3) F 型子权限（查看 secret / install 命令）
INSERT INTO public.menu (
  father_id, menu_name, menu_type, al_icon, icon, path, code, order_num, status, new_link_flag, visible
)
SELECT parent.id,
       U&'\67E5\770B\5B89\88C5\547D\4EE4',         -- "查看安装命令"
       'F', NULL, NULL, NULL,
       'default:account:my-license:reveal',
       1, true, false, true
FROM public.menu parent
WHERE parent.code = 'default:account:my-license'
  AND NOT EXISTS (
    SELECT 1 FROM public.menu m WHERE m.code = 'default:account:my-license:reveal'
  );

-- ----------------------------------------------------------------------------
-- 4) 授权：所有现有 role 都授予两个 code（菜单 + reveal 按钮）
--    终端用户自己的 license 显然允许自己看安装命令，所以 reveal 默认给
-- ----------------------------------------------------------------------------
INSERT INTO public.sys_role_perm (role_id, perm_code)
SELECT r.id, seed.perm_code
FROM public.role r
CROSS JOIN (
  VALUES
    ('default:account:my-license'),
    ('default:account:my-license:reveal')
) AS seed(perm_code)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.sys_role_perm rp
  WHERE rp.role_id = r.id AND rp.perm_code = seed.perm_code
);

COMMIT;
