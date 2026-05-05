-- B3 客户机器本地 SQLite schema 0001：业务初始化
--
-- 与主站 nest-api/sql/energy-rental-init.sql 的关系：
--   - 主站 PG schema 是全局多租户视角（带 agent_id 列、有 agent_profiles 等管理表）
--   - 本 SQLite schema 是单 agent 视角：每个客户机器一份库，库内不需要 agent_id 列
--
-- 主要类型映射（PG → SQLite）：
--   integer GENERATED ALWAYS AS IDENTITY PK → INTEGER PRIMARY KEY AUTOINCREMENT
--   varchar(N)                              → TEXT（SQLite 类型亲和，不强约束长度）
--   numeric(20,0)                           → TEXT（保 SUN 大整数精度，Go 端 big.Int 处理）
--   numeric(36,18)                          → TEXT（同上）
--   timestamp                               → TEXT（ISO 8601 字符串）
--   boolean                                 → INTEGER（0=false, 1=true）
--   now()                                   → (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
--
-- 用 PRAGMA foreign_keys=ON 启用外键约束（默认关闭）。

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

-- 能量套餐（客户本地维护自家套餐，主站 platform_price 通过 RPC 镜像同步）
CREATE TABLE IF NOT EXISTS energy_packages (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  platform_package_id INTEGER,
  package_kind        TEXT NOT NULL DEFAULT 'admin_package',
  package_name        TEXT NOT NULL,
  energy_amount       INTEGER NOT NULL,
  duration_hours      INTEGER NOT NULL,
  price_sun           TEXT NOT NULL,
  idle_price_sun      TEXT,
  busy_price_sun      TEXT,
  status              TEXT NOT NULL DEFAULT 'active',
  sort_order          INTEGER NOT NULL DEFAULT 0,
  description         TEXT,
  updated_at          TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_energy_packages_platform_package_id ON energy_packages (platform_package_id);
CREATE INDEX IF NOT EXISTS idx_energy_packages_package_kind        ON energy_packages (package_kind);

-- 能量订单
CREATE TABLE IF NOT EXISTS energy_orders (
  id                            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no                      TEXT NOT NULL,
  package_id                    INTEGER NOT NULL,
  package_name                  TEXT NOT NULL,
  buyer_address                 TEXT NOT NULL,
  receiver_address              TEXT NOT NULL,
  energy_amount                 INTEGER NOT NULL,
  duration_hours                INTEGER NOT NULL,
  payment_amount_sun            TEXT NOT NULL,
  payment_expires_at            TEXT,
  payment_tx_hash               TEXT,
  rent_tx_hash                  TEXT,
  energy_provider               TEXT NOT NULL DEFAULT 'justlend',
  external_order_id             TEXT,
  external_provider_environment TEXT,
  external_status               TEXT,
  external_confirm_status       TEXT,
  provider_cost_sun             TEXT,
  status                        TEXT NOT NULL DEFAULT 'pending',
  return_status                 TEXT NOT NULL DEFAULT 'none',
  rented_at                     TEXT,
  expires_at                    TEXT,
  returned_at                   TEXT,
  remark                        TEXT,
  updated_at                    TEXT,
  created_at                    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at                    TEXT
);
CREATE INDEX IF NOT EXISTS idx_energy_orders_order_no ON energy_orders (order_no);
CREATE INDEX IF NOT EXISTS idx_energy_orders_status   ON energy_orders (status);

-- 钱包交易流水
CREATE TABLE IF NOT EXISTS energy_wallet_transactions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_hash           TEXT NOT NULL,
  wallet_address    TEXT NOT NULL,
  direction         TEXT NOT NULL,
  transaction_type  TEXT NOT NULL,
  amount_sun        TEXT NOT NULL,
  related_order_id  INTEGER,
  status            TEXT NOT NULL DEFAULT 'pending',
  confirmed_at      TEXT,
  remark            TEXT,
  updated_at        TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_energy_wallet_transactions_tx_hash ON energy_wallet_transactions (tx_hash);

-- 能量归还任务
CREATE TABLE IF NOT EXISTS energy_return_tasks (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id             INTEGER NOT NULL,
  receiver_address     TEXT NOT NULL,
  energy_amount        INTEGER NOT NULL,
  delegated_amount_sun TEXT,
  status               TEXT NOT NULL DEFAULT 'pending',
  attempts             INTEGER NOT NULL DEFAULT 0,
  last_error           TEXT,
  next_retry_at        TEXT,
  completed_at         TEXT,
  updated_at           TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at           TEXT
);
CREATE INDEX IF NOT EXISTS idx_energy_return_tasks_status ON energy_return_tasks (status);

-- 用户 TG 绑定地址
CREATE TABLE IF NOT EXISTS energy_user_addresses (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_chat_id  INTEGER NOT NULL,
  label             TEXT NOT NULL,
  address           TEXT NOT NULL,
  is_default        INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'active',
  remark            TEXT,
  updated_at        TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_energy_user_addresses_chat_id ON energy_user_addresses (telegram_chat_id);
CREATE INDEX IF NOT EXISTS idx_energy_user_addresses_address ON energy_user_addresses (address);
CREATE UNIQUE INDEX IF NOT EXISTS uq_energy_user_addresses_active_address
  ON energy_user_addresses (telegram_chat_id, lower(address))
  WHERE deleted_at IS NULL AND status = 'active';

-- 平台本地配置（单例）
-- 客户机器维护自己的 TRON 配置、catfee 配置、bitcart 网关等
-- 与 主站 energy_platform_config 的差别：
--   - 单租户：去掉 agent 相关
--   - bot_status / telegram_bot_token 改由 bot_config 表管（bot_status 由 supervisor 决定不存 DB）
CREATE TABLE IF NOT EXISTS energy_platform_config (
  id                                 INTEGER PRIMARY KEY DEFAULT 1,
  tron_api_base_url                  TEXT NOT NULL DEFAULT 'https://api.trongrid.io',
  tron_api_key                       TEXT,
  justlend_contract_address          TEXT,
  justlend_payer_private_key         TEXT,
  energy_provider                    TEXT NOT NULL DEFAULT 'justlend',
  catfee_environment                 TEXT NOT NULL DEFAULT 'nile',
  catfee_prod_api_base_url           TEXT NOT NULL DEFAULT 'https://api.catfee.io',
  catfee_prod_api_key                TEXT,
  catfee_prod_api_secret             TEXT,
  catfee_nile_api_base_url           TEXT NOT NULL DEFAULT 'https://nile.catfee.io',
  catfee_nile_api_key                TEXT,
  catfee_nile_api_secret             TEXT,
  catfee_auto_activate               INTEGER NOT NULL DEFAULT 1,
  order_payment_ttl_minutes          INTEGER NOT NULL DEFAULT 10,
  telegram_polling_interval_seconds  INTEGER NOT NULL DEFAULT 2,
  worker_interval_seconds            INTEGER NOT NULL DEFAULT 60,
  min_trx_reserve_sun                TEXT NOT NULL DEFAULT '0',
  bitcart_api_base_url               TEXT,
  bitcart_admin_base_url             TEXT,
  bitcart_api_token                  TEXT,
  bitcart_store_id                   TEXT,
  bitcart_currency                   TEXT NOT NULL DEFAULT 'TRX',
  bitcart_webhook_base_url           TEXT,
  bitcart_webhook_secret             TEXT,
  updated_at                         TEXT,
  created_at                         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at                         TEXT,
  CHECK (id = 1)
);
INSERT OR IGNORE INTO energy_platform_config (id) VALUES (1);

-- Bot 配置（单例）
-- 由 agent supervisor 收到 agent.applyConfig RPC 后写入；本表内容已经过 agent 本地
-- 二次 AES-GCM 加密（key = HKDF(license_secret)），只有 bot 子进程能解。
CREATE TABLE IF NOT EXISTS bot_config (
  id                       INTEGER PRIMARY KEY DEFAULT 1,
  config_version           INTEGER NOT NULL DEFAULT 0,
  encrypted_token          BLOB,
  encrypted_token_nonce    BLOB,
  telegram_bot_username    TEXT,
  welcome_text             TEXT,
  message_config           TEXT,
  menu_config              TEXT,
  applied_at               TEXT,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (id = 1)
);
INSERT OR IGNORE INTO bot_config (id) VALUES (1);
