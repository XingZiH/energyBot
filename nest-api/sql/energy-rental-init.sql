CREATE TABLE IF NOT EXISTS public.energy_packages (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_id integer,
  platform_package_id integer,
  package_kind varchar(32) NOT NULL DEFAULT 'admin_package',
  package_name varchar(100) NOT NULL,
  energy_amount integer NOT NULL,
  duration_hours integer NOT NULL,
  price_sun numeric(20, 0) NOT NULL,
  idle_price_sun numeric(20, 0),
  busy_price_sun numeric(20, 0),
  status varchar(32) NOT NULL DEFAULT 'active',
  sort_order integer NOT NULL DEFAULT 0,
  description text,
  updated_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp
);

CREATE TABLE IF NOT EXISTS public.energy_orders (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_id integer,
  order_no varchar(64) NOT NULL,
  package_id integer NOT NULL,
  package_name varchar(100) NOT NULL,
  buyer_address varchar(128) NOT NULL,
  receiver_address varchar(128) NOT NULL,
  energy_amount integer NOT NULL,
  duration_hours integer NOT NULL,
  payment_amount_sun numeric(20, 0) NOT NULL,
  payment_expires_at timestamp,
  payment_tx_hash varchar(128),
  rent_tx_hash varchar(128),
  energy_provider varchar(32) NOT NULL DEFAULT 'justlend',
  external_order_id varchar(128),
  external_provider_environment varchar(32),
  external_status varchar(64),
  external_confirm_status varchar(64),
  provider_cost_sun numeric(20, 0),
  status varchar(32) NOT NULL DEFAULT 'pending',
  return_status varchar(32) NOT NULL DEFAULT 'none',
  rented_at timestamp,
  expires_at timestamp,
  returned_at timestamp,
  remark text,
  updated_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp
);

CREATE TABLE IF NOT EXISTS public.energy_wallet_transactions (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_id integer,
  tx_hash varchar(128) NOT NULL,
  wallet_address varchar(128) NOT NULL,
  direction varchar(16) NOT NULL,
  transaction_type varchar(64) NOT NULL,
  amount_sun numeric(20, 0) NOT NULL,
  related_order_id integer,
  status varchar(32) NOT NULL DEFAULT 'pending',
  confirmed_at timestamp,
  remark text,
  updated_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp
);

CREATE TABLE IF NOT EXISTS public.agent_profiles (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL,
  agent_name varchar(100) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active',
  remark text,
  updated_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp
);

CREATE TABLE IF NOT EXISTS public.agent_bot_configs (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_id integer NOT NULL,
  bot_status varchar(32) NOT NULL DEFAULT 'disabled',
  telegram_bot_token text,
  telegram_bot_username varchar(128),
  welcome_text text,
  message_config text,
  menu_config text,
  remark text,
  updated_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp
);

CREATE TABLE IF NOT EXISTS public.bot_runtime_status (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_scope varchar(32) NOT NULL,
  agent_id integer,
  desired_status varchar(32) NOT NULL DEFAULT 'disabled',
  runtime_status varchar(32) NOT NULL DEFAULT 'stopped',
  polling_status varchar(32) NOT NULL DEFAULT 'stopped',
  instance_id varchar(128),
  last_heartbeat_at timestamp,
  last_started_at timestamp,
  last_stopped_at timestamp,
  last_error text,
  updated_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp
);

CREATE TABLE IF NOT EXISTS public.agent_wallet_accounts (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_id integer NOT NULL,
  balance_sun numeric(20, 0) NOT NULL DEFAULT 0,
  total_recharge_sun numeric(20, 0) NOT NULL DEFAULT 0,
  total_deducted_sun numeric(20, 0) NOT NULL DEFAULT 0,
  status varchar(32) NOT NULL DEFAULT 'active',
  remark text,
  updated_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp
);

CREATE TABLE IF NOT EXISTS public.agent_recharge_orders (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_id integer NOT NULL,
  order_no varchar(64) NOT NULL,
  requested_amount_sun numeric(20, 0),
  amount_sun numeric(20, 0) NOT NULL,
  payment_gateway varchar(32) NOT NULL DEFAULT 'bitcart',
  payment_address varchar(128) NOT NULL,
  payment_tx_hash varchar(128),
  bitcart_invoice_id varchar(128),
  bitcart_invoice_status varchar(64),
  bitcart_checkout_url text,
  bitcart_payment_id varchar(128),
  bitcart_payment_url text,
  bitcart_payment_currency varchar(32),
  bitcart_payment_amount numeric(36, 18),
  bitcart_exception_status varchar(64),
  bitcart_sent_amount numeric(36, 18),
  bitcart_paid_currency varchar(32),
  status varchar(32) NOT NULL DEFAULT 'pending',
  expires_at timestamp,
  confirmed_at timestamp,
  remark text,
  updated_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp
);

ALTER TABLE public.agent_recharge_orders
  ADD COLUMN IF NOT EXISTS requested_amount_sun numeric(20, 0),
  ADD COLUMN IF NOT EXISTS payment_gateway varchar(32) NOT NULL DEFAULT 'bitcart',
  ADD COLUMN IF NOT EXISTS bitcart_invoice_id varchar(128),
  ADD COLUMN IF NOT EXISTS bitcart_invoice_status varchar(64),
  ADD COLUMN IF NOT EXISTS bitcart_checkout_url text,
  ADD COLUMN IF NOT EXISTS bitcart_payment_id varchar(128),
  ADD COLUMN IF NOT EXISTS bitcart_payment_url text,
  ADD COLUMN IF NOT EXISTS bitcart_payment_currency varchar(32),
  ADD COLUMN IF NOT EXISTS bitcart_payment_amount numeric(36, 18),
  ADD COLUMN IF NOT EXISTS bitcart_exception_status varchar(64),
  ADD COLUMN IF NOT EXISTS bitcart_sent_amount numeric(36, 18),
  ADD COLUMN IF NOT EXISTS bitcart_paid_currency varchar(32);

ALTER TABLE public.agent_bot_configs
  ADD COLUMN IF NOT EXISTS welcome_text text,
  ADD COLUMN IF NOT EXISTS message_config text,
  ADD COLUMN IF NOT EXISTS menu_config text;

CREATE TABLE IF NOT EXISTS public.energy_return_tasks (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id integer NOT NULL,
  receiver_address varchar(128) NOT NULL,
  energy_amount integer NOT NULL,
  delegated_amount_sun numeric(20, 0),
  status varchar(32) NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_retry_at timestamp,
  completed_at timestamp,
  updated_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp
);

CREATE TABLE IF NOT EXISTS public.energy_platform_config (
  id integer PRIMARY KEY DEFAULT 1,
  bot_status varchar(32) NOT NULL DEFAULT 'disabled',
  telegram_bot_token text,
  welcome_text text,
  message_config text,
  menu_config text,
  tron_api_base_url varchar(255) NOT NULL DEFAULT 'https://api.trongrid.io',
  tron_api_key text,
  justlend_contract_address varchar(128),
  justlend_payer_private_key text,
  energy_provider varchar(32) NOT NULL DEFAULT 'justlend',
  catfee_environment varchar(32) NOT NULL DEFAULT 'nile',
  catfee_prod_api_base_url varchar(255) NOT NULL DEFAULT 'https://api.catfee.io',
  catfee_prod_api_key text,
  catfee_prod_api_secret text,
  catfee_nile_api_base_url varchar(255) NOT NULL DEFAULT 'https://nile.catfee.io',
  catfee_nile_api_key text,
  catfee_nile_api_secret text,
  catfee_auto_activate boolean NOT NULL DEFAULT true,
  order_payment_ttl_minutes integer NOT NULL DEFAULT 10,
  telegram_polling_interval_seconds integer NOT NULL DEFAULT 2,
  worker_interval_seconds integer NOT NULL DEFAULT 60,
  min_trx_reserve_sun numeric(20, 0) NOT NULL DEFAULT 0,
  bitcart_api_base_url varchar(255),
  bitcart_admin_base_url varchar(255),
  bitcart_api_token text,
  bitcart_store_id varchar(128),
  bitcart_currency varchar(32) NOT NULL DEFAULT 'TRX',
  bitcart_webhook_base_url varchar(255),
  bitcart_webhook_secret text,
  updated_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp,
  CONSTRAINT energy_platform_config_singleton CHECK (id = 1)
);

ALTER TABLE public.energy_orders
  ADD COLUMN IF NOT EXISTS agent_id integer,
  ADD COLUMN IF NOT EXISTS energy_provider varchar(32) NOT NULL DEFAULT 'justlend',
  ADD COLUMN IF NOT EXISTS external_order_id varchar(128),
  ADD COLUMN IF NOT EXISTS external_provider_environment varchar(32),
  ADD COLUMN IF NOT EXISTS external_status varchar(64),
  ADD COLUMN IF NOT EXISTS external_confirm_status varchar(64),
  ADD COLUMN IF NOT EXISTS provider_cost_sun numeric(20, 0);

ALTER TABLE public.energy_packages
  ADD COLUMN IF NOT EXISTS agent_id integer,
  ADD COLUMN IF NOT EXISTS platform_package_id integer,
  ADD COLUMN IF NOT EXISTS package_kind varchar(32) NOT NULL DEFAULT 'admin_package',
  ADD COLUMN IF NOT EXISTS idle_price_sun numeric(20, 0),
  ADD COLUMN IF NOT EXISTS busy_price_sun numeric(20, 0);

UPDATE public.energy_packages
SET package_kind = 'platform_price'
WHERE agent_id IS NULL
  AND platform_package_id IS NULL
  AND deleted_at IS NULL
  AND package_kind = 'admin_package'
  AND NOT EXISTS (
    SELECT 1
    FROM public.energy_packages existing
    WHERE existing.package_kind = 'platform_price'
  );

UPDATE public.energy_packages
SET package_kind = 'admin_package',
    platform_package_id = NULL
WHERE agent_id IS NULL
  AND platform_package_id IS NOT NULL
  AND deleted_at IS NULL;

UPDATE public.energy_packages
SET package_kind = 'user_package'
WHERE agent_id IS NOT NULL
  AND platform_package_id IS NOT NULL
  AND deleted_at IS NULL;

ALTER TABLE public.energy_user_addresses
  ADD COLUMN IF NOT EXISTS agent_id integer;

ALTER TABLE public.energy_wallet_transactions
  ADD COLUMN IF NOT EXISTS agent_id integer;

ALTER TABLE public.energy_platform_config
  ADD COLUMN IF NOT EXISTS energy_provider varchar(32) NOT NULL DEFAULT 'justlend',
  ADD COLUMN IF NOT EXISTS welcome_text text,
  ADD COLUMN IF NOT EXISTS message_config text,
  ADD COLUMN IF NOT EXISTS menu_config text,
  ADD COLUMN IF NOT EXISTS catfee_environment varchar(32) NOT NULL DEFAULT 'nile',
  ADD COLUMN IF NOT EXISTS catfee_prod_api_base_url varchar(255) NOT NULL DEFAULT 'https://api.catfee.io',
  ADD COLUMN IF NOT EXISTS catfee_prod_api_key text,
  ADD COLUMN IF NOT EXISTS catfee_prod_api_secret text,
  ADD COLUMN IF NOT EXISTS catfee_nile_api_base_url varchar(255) NOT NULL DEFAULT 'https://nile.catfee.io',
  ADD COLUMN IF NOT EXISTS catfee_nile_api_key text,
  ADD COLUMN IF NOT EXISTS catfee_nile_api_secret text,
  ADD COLUMN IF NOT EXISTS catfee_auto_activate boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS bitcart_api_base_url varchar(255),
  ADD COLUMN IF NOT EXISTS bitcart_admin_base_url varchar(255),
  ADD COLUMN IF NOT EXISTS bitcart_api_token text,
  ADD COLUMN IF NOT EXISTS bitcart_store_id varchar(128),
  ADD COLUMN IF NOT EXISTS bitcart_currency varchar(32) NOT NULL DEFAULT 'TRX',
  ADD COLUMN IF NOT EXISTS bitcart_webhook_base_url varchar(255),
  ADD COLUMN IF NOT EXISTS bitcart_webhook_secret text;

CREATE INDEX IF NOT EXISTS idx_energy_orders_order_no
  ON public.energy_orders (order_no);
CREATE INDEX IF NOT EXISTS idx_energy_orders_status
  ON public.energy_orders (status);
CREATE INDEX IF NOT EXISTS idx_energy_orders_agent_id
  ON public.energy_orders (agent_id);
CREATE INDEX IF NOT EXISTS idx_energy_packages_agent_id
  ON public.energy_packages (agent_id);
CREATE INDEX IF NOT EXISTS idx_energy_packages_platform_package_id
  ON public.energy_packages (platform_package_id);
CREATE INDEX IF NOT EXISTS idx_energy_packages_package_kind
  ON public.energy_packages (package_kind);
CREATE INDEX IF NOT EXISTS idx_energy_user_addresses_agent_id
  ON public.energy_user_addresses (agent_id);
CREATE INDEX IF NOT EXISTS idx_energy_wallet_transactions_agent_id
  ON public.energy_wallet_transactions (agent_id);
CREATE INDEX IF NOT EXISTS idx_energy_return_tasks_status
  ON public.energy_return_tasks (status);
DROP INDEX IF EXISTS public.uq_energy_user_addresses_active_address;
CREATE UNIQUE INDEX IF NOT EXISTS uq_energy_user_addresses_active_agent_address
  ON public.energy_user_addresses (coalesce(agent_id, 0), telegram_chat_id, lower(address))
  WHERE deleted_at IS NULL AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_agent_profiles_user_id
  ON public.agent_profiles (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bot_runtime_status_scope_agent
  ON public.bot_runtime_status (bot_scope, coalesce(agent_id, 0));
CREATE INDEX IF NOT EXISTS idx_bot_runtime_status_last_heartbeat
  ON public.bot_runtime_status (last_heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_agent_wallet_accounts_agent_id
  ON public.agent_wallet_accounts (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_recharge_orders_agent_id
  ON public.agent_recharge_orders (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_recharge_orders_bitcart_invoice_id
  ON public.agent_recharge_orders (bitcart_invoice_id);

INSERT INTO public.energy_platform_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.energy_packages (
  package_kind,
  package_name,
  energy_amount,
  duration_hours,
  price_sun,
  status,
  sort_order,
  description
)
SELECT 'platform_price', seed.*
FROM (
  VALUES
    ('32K 能量 / 1 小时', 32000, 1, 12000000, 'active', 1, '适合低频转账试用'),
    ('64K 能量 / 1 小时', 64000, 1, 22000000, 'active', 2, '适合普通转账场景'),
    ('128K 能量 / 1 小时', 128000, 1, 90000000, 'active', 3, '适合高频快速归还场景')
) AS seed(package_name, energy_amount, duration_hours, price_sun, status, sort_order, description)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.energy_packages p
  WHERE p.energy_amount = seed.energy_amount
    AND p.duration_hours = seed.duration_hours
    AND p.agent_id IS NULL
    AND p.platform_package_id IS NULL
);

UPDATE public.energy_packages
SET package_name = CASE energy_amount
  WHEN 32000 THEN '32K 能量 / 1 小时'
  WHEN 64000 THEN '64K 能量 / 1 小时'
  WHEN 128000 THEN '128K 能量 / 1 小时'
  ELSE package_name
END,
description = CASE energy_amount
  WHEN 32000 THEN '适合低频转账试用'
  WHEN 64000 THEN '适合普通转账场景'
  WHEN 128000 THEN '适合高频快速归还场景'
  ELSE description
END
WHERE duration_hours = 1
  AND energy_amount IN (32000, 64000, 128000)
  AND package_kind = 'platform_price'
  AND agent_id IS NULL
  AND platform_package_id IS NULL;

UPDATE public.energy_packages
SET idle_price_sun = CASE
    WHEN energy_amount = 65000 AND duration_hours = 1 THEN 1755000
    ELSE coalesce(idle_price_sun, price_sun)
  END,
  busy_price_sun = CASE
    WHEN energy_amount = 65000 AND duration_hours = 1 THEN 2405000
    ELSE coalesce(busy_price_sun, price_sun)
  END
WHERE idle_price_sun IS NULL
   OR busy_price_sun IS NULL;

INSERT INTO public.menu (
  father_id,
  menu_name,
  menu_type,
  al_icon,
  icon,
  path,
  code,
  order_num,
  status,
  new_link_flag,
  visible
)
SELECT 0, U&'\673A\5668\4EBA\63A7\5236', 'C', NULL, 'thunderbolt', '/default/energy-rental', 'default:energy-rental', 1, true, false, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.menu WHERE code = 'default:energy-rental'
);

INSERT INTO public.menu (
  father_id,
  menu_name,
  menu_type,
  al_icon,
  icon,
  path,
  code,
  order_num,
  status,
  new_link_flag,
  visible
)
SELECT parent.id, child.menu_name, child.menu_type, NULL, child.icon, child.path, child.code, child.order_num, true, false, true
FROM public.menu parent
CROSS JOIN (
  VALUES
    (U&'\63A7\5236\53F0', 'C', 'dashboard', '/default/energy-rental/dashboard', 'default:energy-rental:dashboard', 1),
    (U&'\673A\5668\4EBA\914D\7F6E', 'C', 'robot', '/default/energy-rental/bot-config', 'default:energy-rental:bot-config', 2),
    (U&'\7528\6237\5145\503C', 'C', 'transaction', '/default/energy-rental/agent-recharge', 'default:energy-rental:agent-recharge', 3),
    (U&'\5E73\53F0\914D\7F6E', 'C', 'setting', '/default/energy-rental/platform-config', 'default:energy-rental:platform-config', 4),
    (U&'\94FE\8DEF\6D4B\8BD5', 'C', 'experiment', '/default/energy-rental/link-test', 'default:energy-rental:link-test', 5),
    (U&'\5957\9910\914D\7F6E', 'C', 'profile', '/default/energy-rental/packages', 'default:energy-rental:packages', 6),
    (U&'\5730\5740\7BA1\7406', 'C', 'environment', '/default/energy-rental/address-management', 'default:energy-rental:addresses', 7),
    (U&'\8BA2\5355\7BA1\7406', 'C', 'ordered-list', '/default/energy-rental/orders', 'default:energy-rental:orders', 8),
    (U&'\94B1\5305\6D41\6C34', 'C', 'wallet', '/default/energy-rental/wallet-transactions', 'default:energy-rental:wallet-transactions', 9),
    (U&'\5F52\8FD8\4EFB\52A1', 'C', 'sync', '/default/energy-rental/return-tasks', 'default:energy-rental:return-tasks', 10)
) AS child(menu_name, menu_type, icon, path, code, order_num)
WHERE parent.code = 'default:energy-rental'
  AND NOT EXISTS (
    SELECT 1 FROM public.menu m WHERE m.code = child.code
  );

INSERT INTO public.menu (
  father_id,
  menu_name,
  menu_type,
  al_icon,
  icon,
  path,
  code,
  order_num,
  status,
  new_link_flag,
  visible
)
SELECT parent.id, child.menu_name, 'F', NULL, NULL, NULL, child.code, child.order_num, true, false, true
FROM public.menu parent
CROSS JOIN (
  VALUES
    (U&'\7F16\8F91\914D\7F6E', 'default:energy-rental:platform-config:edit', 'default:energy-rental:platform-config', 1),
    (U&'\65B0\589E\5957\9910', 'default:energy-rental:packages:add', 'default:energy-rental:packages', 1),
    (U&'\7F16\8F91\5957\9910', 'default:energy-rental:packages:edit', 'default:energy-rental:packages', 2),
    (U&'\5220\9664\5957\9910', 'default:energy-rental:packages:del', 'default:energy-rental:packages', 3),
    (U&'\7F16\8F91\8BA2\5355', 'default:energy-rental:orders:edit', 'default:energy-rental:orders', 1),
    (U&'\91CD\8BD5\5F52\8FD8', 'default:energy-rental:return-tasks:retry', 'default:energy-rental:return-tasks', 1)
) AS child(menu_name, code, parent_code, order_num)
WHERE parent.code = child.parent_code
  AND NOT EXISTS (
    SELECT 1 FROM public.menu m WHERE m.code = child.code
  );

UPDATE public.menu
SET menu_name = CASE code
  WHEN 'default:energy-rental' THEN U&'\673A\5668\4EBA\63A7\5236'
  WHEN 'default:energy-rental:dashboard' THEN U&'\63A7\5236\53F0'
  WHEN 'default:energy-rental:bot-config' THEN U&'\673A\5668\4EBA\914D\7F6E'
  WHEN 'default:energy-rental:agent-recharge' THEN U&'\7528\6237\5145\503C'
  WHEN 'default:energy-rental:platform-config' THEN U&'\5E73\53F0\914D\7F6E'
  WHEN 'default:energy-rental:link-test' THEN U&'\94FE\8DEF\6D4B\8BD5'
  WHEN 'default:energy-rental:packages' THEN U&'\5957\9910\914D\7F6E'
  WHEN 'default:energy-rental:addresses' THEN U&'\5730\5740\7BA1\7406'
  WHEN 'default:energy-rental:orders' THEN U&'\8BA2\5355\7BA1\7406'
  WHEN 'default:energy-rental:wallet-transactions' THEN U&'\94B1\5305\6D41\6C34'
  WHEN 'default:energy-rental:return-tasks' THEN U&'\5F52\8FD8\4EFB\52A1'
  WHEN 'default:energy-rental:platform-config:edit' THEN U&'\7F16\8F91\914D\7F6E'
  WHEN 'default:energy-rental:packages:add' THEN U&'\65B0\589E\5957\9910'
  WHEN 'default:energy-rental:packages:edit' THEN U&'\7F16\8F91\5957\9910'
  WHEN 'default:energy-rental:packages:del' THEN U&'\5220\9664\5957\9910'
  WHEN 'default:energy-rental:orders:edit' THEN U&'\7F16\8F91\8BA2\5355'
  WHEN 'default:energy-rental:return-tasks:retry' THEN U&'\91CD\8BD5\5F52\8FD8'
  ELSE menu_name
END
WHERE code LIKE 'default:energy-rental%';

UPDATE public.menu
SET order_num = CASE code
  WHEN 'default:energy-rental:dashboard' THEN 1
  WHEN 'default:energy-rental:bot-config' THEN 2
  WHEN 'default:energy-rental:agent-recharge' THEN 3
  WHEN 'default:energy-rental:platform-config' THEN 4
  WHEN 'default:energy-rental:link-test' THEN 5
  WHEN 'default:energy-rental:packages' THEN 6
  WHEN 'default:energy-rental:addresses' THEN 7
  WHEN 'default:energy-rental:orders' THEN 8
  WHEN 'default:energy-rental:wallet-transactions' THEN 9
  WHEN 'default:energy-rental:return-tasks' THEN 10
  ELSE order_num
END
WHERE code LIKE 'default:energy-rental:%';

UPDATE public.menu
SET order_num = CASE code
  WHEN 'default:energy-rental:platform-config:edit' THEN 1
  WHEN 'default:energy-rental:packages:add' THEN 1
  WHEN 'default:energy-rental:packages:edit' THEN 2
  WHEN 'default:energy-rental:packages:del' THEN 3
  WHEN 'default:energy-rental:orders:edit' THEN 1
  WHEN 'default:energy-rental:return-tasks:retry' THEN 1
  ELSE order_num
END
WHERE code IN (
  'default:energy-rental:platform-config:edit',
  'default:energy-rental:packages:add',
  'default:energy-rental:packages:edit',
  'default:energy-rental:packages:del',
  'default:energy-rental:orders:edit',
  'default:energy-rental:return-tasks:retry'
);

UPDATE public.menu
SET order_num = 1
WHERE code = 'default:energy-rental';

UPDATE public.menu
SET order_num = 2
WHERE code = 'default:system';

INSERT INTO public.sys_role_perm (role_id, perm_code)
SELECT 1, seed.perm_code
FROM (
  VALUES
    ('default:energy-rental'),
    ('default:energy-rental:dashboard'),
    ('default:energy-rental:bot-config'),
    ('default:energy-rental:platform-config'),
    ('default:energy-rental:platform-config:edit'),
    ('default:energy-rental:link-test'),
    ('default:energy-rental:packages'),
    ('default:energy-rental:packages:add'),
    ('default:energy-rental:packages:edit'),
    ('default:energy-rental:packages:del'),
    ('default:energy-rental:addresses'),
    ('default:energy-rental:orders'),
    ('default:energy-rental:orders:edit'),
    ('default:energy-rental:wallet-transactions'),
    ('default:energy-rental:return-tasks'),
    ('default:energy-rental:return-tasks:retry')
) AS seed(perm_code)
WHERE EXISTS (SELECT 1 FROM public.role WHERE id = 1)
  AND NOT EXISTS (
    SELECT 1
    FROM public.sys_role_perm rp
    WHERE rp.role_id = 1 AND rp.perm_code = seed.perm_code
  );

DELETE FROM public.sys_role_perm
WHERE role_id = 1
  AND perm_code = 'default:energy-rental:agent-recharge';

DELETE FROM public.sys_role_perm
WHERE perm_code = 'default:energy-rental:agent-recharge:confirm';

DELETE FROM public.menu
WHERE code = 'default:energy-rental:agent-recharge:confirm';

UPDATE public.role
SET role_name = U&'\7528\6237',
    role_desc = U&'\6CE8\518C\7528\6237\9ED8\8BA4\89D2\8272'
WHERE role_name = U&'\4EE3\7406\5546'
  AND NOT EXISTS (
    SELECT 1 FROM public.role target WHERE target.role_name = U&'\7528\6237'
  );

UPDATE public.sys_user_role user_role
SET role_id = target.id
FROM public.role legacy, public.role target
WHERE legacy.role_name = U&'\4EE3\7406\5546'
  AND target.role_name = U&'\7528\6237'
  AND user_role.role_id = legacy.id;

DELETE FROM public.role legacy
WHERE legacy.role_name = U&'\4EE3\7406\5546'
  AND NOT EXISTS (
    SELECT 1 FROM public.sys_user_role user_role WHERE user_role.role_id = legacy.id
  );

INSERT INTO public.role (role_name, role_desc)
SELECT U&'\7528\6237', U&'\6CE8\518C\7528\6237\9ED8\8BA4\89D2\8272'
WHERE NOT EXISTS (
  SELECT 1 FROM public.role WHERE role_name = U&'\7528\6237'
);

INSERT INTO public.sys_role_perm (role_id, perm_code)
SELECT role_table.id, seed.perm_code
FROM public.role role_table
CROSS JOIN (
  VALUES
    ('default:energy-rental'),
    ('default:energy-rental:dashboard'),
    ('default:energy-rental:bot-config'),
    ('default:energy-rental:agent-recharge'),
    ('default:energy-rental:packages'),
    ('default:energy-rental:packages:add'),
    ('default:energy-rental:packages:edit'),
    ('default:energy-rental:packages:del'),
    ('default:energy-rental:addresses'),
    ('default:energy-rental:orders'),
    ('default:energy-rental:wallet-transactions')
) AS seed(perm_code)
WHERE role_table.role_name = U&'\7528\6237'
  AND NOT EXISTS (
    SELECT 1
    FROM public.sys_role_perm rp
    WHERE rp.role_id = role_table.id
      AND rp.perm_code = seed.perm_code
  );
