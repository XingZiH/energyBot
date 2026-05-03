-- 子系统 A：License 颁发与客户管理初始化 migration
--
-- 背景：energybot 引入"Bot-as-a-Service 自托管"模式，内部销售在后台创建客户后，
--       系统为每个客户签发 license（key + secret），客户用一键部署脚本 install.sh
--       在自己的 VPS 上拉起 agent/bot 容器，启动前走 HMAC 签名的 precheck 端点。
--
-- 本 migration：
--   1) 建立 public.customers（客户档案）和 public.licenses（license 颁发记录）两张表
--   2) 在 public.menu 下挂 "客户管理"（default:system:customers）一级菜单 + 三个 F 型 action code
--   3) 给超管 role_id=1 授 5 个权限码
--
-- 权限码约定（复用项目现有风格 default:模块:action）：
--   - default:system:customers         查看客户列表与详情（菜单级 C）
--   - default:system:customers:add     创建客户并发放 license（F）
--   - default:system:customers:edit    修改客户基本信息（F）
--   - default:system:customers:revoke  吊销 / 重新颁发 license（F）
--   - default:system:customers:reveal  查看 license secret 明文（高敏感，F）
--
-- 关联：nest-api/src/drizzle/schema.ts 中的 customersTable / licensesTable；
--       回滚脚本：sql/rollback/20260503-customers-and-licenses.rollback.sql。
--
-- 上线步骤：
--   1. 检查 nest-api .env 中已配置 LICENSE_SECRET_ENC_KEY（32B base64，否则 nest-api 启动失败）
--   2. psql $DATABASE_URL -f 20260503-customers-and-licenses.sql
--   3. 重启 nest-api
--   4. 若需回滚：psql $DATABASE_URL -f rollback/20260503-customers-and-licenses.rollback.sql

BEGIN;

-- ----------------------------------------------------------------------------
-- customers：客户档案
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customers (
    id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name         VARCHAR(120)  NOT NULL,
    contact      VARCHAR(255),
    remark       TEXT,
    status       VARCHAR(32)   NOT NULL DEFAULT 'active', -- active | suspended
    created_by   INTEGER       NOT NULL,
    updated_at   TIMESTAMP,
    created_at   TIMESTAMP     NOT NULL DEFAULT now(),
    deleted_at   TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customers_status     ON public.customers (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customers_created_at ON public.customers (created_at DESC);

-- ----------------------------------------------------------------------------
-- licenses：license 颁发记录
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.licenses (
    id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id     INTEGER       NOT NULL,
    license_key     VARCHAR(64)   NOT NULL UNIQUE, -- "ebt_" + base58(24B)
    secret_cipher   VARCHAR(200)  NOT NULL,         -- base64(AES-256-GCM(iv||ct||tag))
    issued_at       TIMESTAMP     NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMP,                      -- NULL = 有效
    revoked_reason  VARCHAR(255),
    issued_by       INTEGER       NOT NULL,
    last_seen_at    TIMESTAMP,
    updated_at      TIMESTAMP,
    created_at      TIMESTAMP     NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_licenses_customer_id ON public.licenses (customer_id);
CREATE INDEX IF NOT EXISTS idx_licenses_revoked_at  ON public.licenses (revoked_at);

-- ----------------------------------------------------------------------------
-- 菜单：在 default:system 下新增 "客户管理" C 型菜单
-- ----------------------------------------------------------------------------
INSERT INTO public.menu (
  father_id, menu_name, menu_type, al_icon, icon, path, code, order_num, status, new_link_flag, visible
)
SELECT parent.id,
       U&'\5BA2\6237\7BA1\7406',                   -- "客户管理"
       'C', NULL, 'team',
       '/default/system/customers',
       'default:system:customers',
       100, true, false, true
FROM public.menu parent
WHERE parent.code = 'default:system'
  AND NOT EXISTS (
    SELECT 1 FROM public.menu m WHERE m.code = 'default:system:customers'
  );

-- F 型 action code（按钮级权限，挂在"客户管理"菜单下）
INSERT INTO public.menu (
  father_id, menu_name, menu_type, al_icon, icon, path, code, order_num, status, new_link_flag, visible
)
SELECT parent.id, child.menu_name, 'F', NULL, NULL, NULL, child.code, child.order_num, true, false, true
FROM public.menu parent
CROSS JOIN (
  VALUES
    (U&'\65B0\589E\5BA2\6237',      'default:system:customers:add',    1),  -- "新增客户"
    (U&'\7F16\8F91\5BA2\6237',      'default:system:customers:edit',   2),  -- "编辑客户"
    (U&'\540A\9500\4E0E\91CD\53D1', 'default:system:customers:revoke', 3),  -- "吊销与重发"
    (U&'\67E5\770B\79D8\94A5',      'default:system:customers:reveal', 4)   -- "查看秘钥"
) AS child(menu_name, code, order_num)
WHERE parent.code = 'default:system:customers'
  AND NOT EXISTS (
    SELECT 1 FROM public.menu m WHERE m.code = child.code
  );

-- ----------------------------------------------------------------------------
-- 给超管 role_id=1 授权
-- ----------------------------------------------------------------------------
INSERT INTO public.sys_role_perm (role_id, perm_code)
SELECT 1, seed.perm_code
FROM (
  VALUES
    ('default:system:customers'),
    ('default:system:customers:add'),
    ('default:system:customers:edit'),
    ('default:system:customers:revoke'),
    ('default:system:customers:reveal')
) AS seed(perm_code)
WHERE EXISTS (SELECT 1 FROM public.role WHERE id = 1)
  AND NOT EXISTS (
    SELECT 1
    FROM public.sys_role_perm rp
    WHERE rp.role_id = 1 AND rp.perm_code = seed.perm_code
  );

COMMIT;
