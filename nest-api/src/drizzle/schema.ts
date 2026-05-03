import {
  pgTable,
  integer,
  bigint,
  varchar,
  boolean,
  timestamp,
  numeric,
  text,
} from 'drizzle-orm/pg-core';

const timestamps = {
  updatedAt: timestamp('updated_at'),
  createdAt: timestamp('created_at')
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp('deleted_at'),
};

// User 表
export const userTable = pgTable('user', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  email: varchar({ length: 255 }), // 可选字段
  userName: varchar('user_name', { length: 255 }).notNull(), // 用户名
  password: varchar({ length: 255 }).notNull(), // 密码
  available: boolean().notNull(), // 可用性
  sex: integer().notNull(), // 性别
  mobile: varchar({ length: 20 }).notNull(), // 手机号码
  telephone: varchar({ length: 20 }), // 电话号码
  departmentId: integer('department_id').notNull(), // 部门 ID
  lastLoginTime: timestamp('last_login_time').defaultNow(), // 最后登录时间
  // 绑定的客户 id（仅终端客户账号会填，内部操作员/管理员为 NULL）。
  // 新建客户时可由管理端同步创建登录账号并写入此字段。
  customerId: integer('customer_id'),
  ...timestamps,
});

export const energyPackagesTable = pgTable('energy_packages', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  agentId: integer('agent_id'),
  platformPackageId: integer('platform_package_id'),
  packageKind: varchar('package_kind', { length: 32 })
    .notNull()
    .default('admin_package'),
  packageName: varchar('package_name', { length: 100 }).notNull(),
  energyAmount: integer('energy_amount').notNull(),
  durationHours: integer('duration_hours').notNull(),
  priceSun: numeric('price_sun', { precision: 20, scale: 0 }).notNull(),
  idlePriceSun: numeric('idle_price_sun', { precision: 20, scale: 0 }),
  busyPriceSun: numeric('busy_price_sun', { precision: 20, scale: 0 }),
  status: varchar({ length: 32 }).notNull().default('active'),
  sortOrder: integer('sort_order').notNull().default(0),
  description: text(),
  ...timestamps,
});

export const energyOrdersTable = pgTable('energy_orders', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  agentId: integer('agent_id'),
  orderNo: varchar('order_no', { length: 64 }).notNull(),
  packageId: integer('package_id').notNull(),
  packageName: varchar('package_name', { length: 100 }).notNull(),
  buyerAddress: varchar('buyer_address', { length: 128 }).notNull(),
  receiverAddress: varchar('receiver_address', { length: 128 }).notNull(),
  energyAmount: integer('energy_amount').notNull(),
  durationHours: integer('duration_hours').notNull(),
  paymentAmountSun: numeric('payment_amount_sun', {
    precision: 20,
    scale: 0,
  }).notNull(),
  paymentExpiresAt: timestamp('payment_expires_at'),
  paymentTxHash: varchar('payment_tx_hash', { length: 128 }),
  rentTxHash: varchar('rent_tx_hash', { length: 128 }),
  energyProvider: varchar('energy_provider', { length: 32 })
    .notNull()
    .default('justlend'),
  externalOrderId: varchar('external_order_id', { length: 128 }),
  externalProviderEnvironment: varchar('external_provider_environment', {
    length: 32,
  }),
  externalStatus: varchar('external_status', { length: 64 }),
  externalConfirmStatus: varchar('external_confirm_status', { length: 64 }),
  providerCostSun: numeric('provider_cost_sun', {
    precision: 20,
    scale: 0,
  }),
  status: varchar({ length: 32 }).notNull().default('pending'),
  returnStatus: varchar('return_status', { length: 32 })
    .notNull()
    .default('none'),
  rentedAt: timestamp('rented_at'),
  expiresAt: timestamp('expires_at'),
  returnedAt: timestamp('returned_at'),
  remark: text(),
  ...timestamps,
});

export const energyUserAddressesTable = pgTable('energy_user_addresses', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  agentId: integer('agent_id'),
  telegramChatId: bigint('telegram_chat_id', { mode: 'bigint' }).notNull(),
  label: varchar({ length: 64 }).notNull(),
  address: varchar({ length: 128 }).notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  status: varchar({ length: 32 }).notNull().default('active'),
  remark: text(),
  ...timestamps,
});

export const energyWalletTransactionsTable = pgTable(
  'energy_wallet_transactions',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    agentId: integer('agent_id'),
    txHash: varchar('tx_hash', { length: 128 }).notNull(),
    walletAddress: varchar('wallet_address', { length: 128 }).notNull(),
    direction: varchar({ length: 16 }).notNull(),
    transactionType: varchar('transaction_type', { length: 64 }).notNull(),
    amountSun: numeric('amount_sun', { precision: 20, scale: 0 }).notNull(),
    relatedOrderId: integer('related_order_id'),
    status: varchar({ length: 32 }).notNull().default('pending'),
    confirmedAt: timestamp('confirmed_at'),
    remark: text(),
    ...timestamps,
  },
);

export const agentProfilesTable = pgTable('agent_profiles', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer('user_id').notNull(),
  agentName: varchar('agent_name', { length: 100 }).notNull(),
  status: varchar({ length: 32 }).notNull().default('active'),
  remark: text(),
  ...timestamps,
});

export const agentBotConfigsTable = pgTable('agent_bot_configs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  agentId: integer('agent_id').notNull(),
  botStatus: varchar('bot_status', { length: 32 })
    .notNull()
    .default('disabled'),
  telegramBotToken: text('telegram_bot_token'),
  telegramBotUsername: varchar('telegram_bot_username', { length: 128 }),
  welcomeText: text('welcome_text'),
  messageConfig: text('message_config'),
  menuConfig: text('menu_config'),
  remark: text(),
  createdAt: timestamp('created_at')
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp('deleted_at'),
  // updatedAt 必须 timestamp(3)（毫秒精度），与 JavaScript Date 对齐。
  // 否则 PG 存微秒 (.493975)，JS 读出只有毫秒 (.493)，回传时
  // `WHERE updated_at = expected` 永远无法匹配 → 乐观锁形同失效，
  // 前端必然报 "配置已被他人修改"。
  // 对应迁移：sql/20260503-updated-at-precision.sql
  updatedAt: timestamp('updated_at', { precision: 3 }).defaultNow().notNull(),
});

export const botRuntimeStatusTable = pgTable('bot_runtime_status', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  botScope: varchar('bot_scope', { length: 32 }).notNull(),
  agentId: integer('agent_id'),
  desiredStatus: varchar('desired_status', { length: 32 })
    .notNull()
    .default('disabled'),
  runtimeStatus: varchar('runtime_status', { length: 32 })
    .notNull()
    .default('stopped'),
  pollingStatus: varchar('polling_status', { length: 32 })
    .notNull()
    .default('stopped'),
  instanceId: varchar('instance_id', { length: 128 }),
  lastHeartbeatAt: timestamp('last_heartbeat_at'),
  lastStartedAt: timestamp('last_started_at'),
  lastStoppedAt: timestamp('last_stopped_at'),
  lastError: text('last_error'),
  ...timestamps,
});

export const agentWalletAccountsTable = pgTable('agent_wallet_accounts', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  agentId: integer('agent_id').notNull(),
  balanceSun: numeric('balance_sun', { precision: 20, scale: 0 })
    .notNull()
    .default('0'),
  totalRechargeSun: numeric('total_recharge_sun', {
    precision: 20,
    scale: 0,
  })
    .notNull()
    .default('0'),
  totalDeductedSun: numeric('total_deducted_sun', {
    precision: 20,
    scale: 0,
  })
    .notNull()
    .default('0'),
  status: varchar({ length: 32 }).notNull().default('active'),
  remark: text(),
  ...timestamps,
});

export const agentRechargeOrdersTable = pgTable('agent_recharge_orders', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  agentId: integer('agent_id').notNull(),
  orderNo: varchar('order_no', { length: 64 }).notNull(),
  requestedAmountSun: numeric('requested_amount_sun', {
    precision: 20,
    scale: 0,
  }),
  amountSun: numeric('amount_sun', { precision: 20, scale: 0 }).notNull(),
  paymentGateway: varchar('payment_gateway', { length: 32 })
    .notNull()
    .default('bitcart'),
  paymentAddress: varchar('payment_address', { length: 128 }).notNull(),
  paymentTxHash: varchar('payment_tx_hash', { length: 128 }),
  bitcartInvoiceId: varchar('bitcart_invoice_id', { length: 128 }),
  bitcartInvoiceStatus: varchar('bitcart_invoice_status', { length: 64 }),
  bitcartCheckoutUrl: text('bitcart_checkout_url'),
  bitcartPaymentId: varchar('bitcart_payment_id', { length: 128 }),
  bitcartPaymentUrl: text('bitcart_payment_url'),
  bitcartPaymentCurrency: varchar('bitcart_payment_currency', { length: 32 }),
  bitcartPaymentAmount: numeric('bitcart_payment_amount', {
    precision: 36,
    scale: 18,
  }),
  bitcartExceptionStatus: varchar('bitcart_exception_status', { length: 64 }),
  bitcartSentAmount: numeric('bitcart_sent_amount', {
    precision: 36,
    scale: 18,
  }),
  bitcartPaidCurrency: varchar('bitcart_paid_currency', { length: 32 }),
  status: varchar({ length: 32 }).notNull().default('pending'),
  expiresAt: timestamp('expires_at'),
  confirmedAt: timestamp('confirmed_at'),
  remark: text(),
  ...timestamps,
});

export const energyReturnTasksTable = pgTable('energy_return_tasks', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  orderId: integer('order_id').notNull(),
  receiverAddress: varchar('receiver_address', { length: 128 }).notNull(),
  energyAmount: integer('energy_amount').notNull(),
  delegatedAmountSun: numeric('delegated_amount_sun', {
    precision: 20,
    scale: 0,
  }),
  status: varchar({ length: 32 }).notNull().default('pending'),
  attempts: integer().notNull().default(0),
  lastError: text('last_error'),
  nextRetryAt: timestamp('next_retry_at'),
  completedAt: timestamp('completed_at'),
  ...timestamps,
});

export const energyPlatformConfigTable = pgTable('energy_platform_config', {
  id: integer().primaryKey(),
  botStatus: varchar('bot_status', { length: 32 })
    .notNull()
    .default('disabled'),
  telegramBotToken: text('telegram_bot_token'),
  welcomeText: text('welcome_text'),
  messageConfig: text('message_config'),
  menuConfig: text('menu_config'),
  tronApiBaseUrl: varchar('tron_api_base_url', { length: 255 })
    .notNull()
    .default('https://api.trongrid.io'),
  tronApiKey: text('tron_api_key'),
  justlendContractAddress: varchar('justlend_contract_address', {
    length: 128,
  }),
  justlendPayerPrivateKey: text('justlend_payer_private_key'),
  energyProvider: varchar('energy_provider', { length: 32 })
    .notNull()
    .default('justlend'),
  catfeeEnvironment: varchar('catfee_environment', { length: 32 })
    .notNull()
    .default('nile'),
  catfeeProdApiBaseUrl: varchar('catfee_prod_api_base_url', {
    length: 255,
  })
    .notNull()
    .default('https://api.catfee.io'),
  catfeeProdApiKey: text('catfee_prod_api_key'),
  catfeeProdApiSecret: text('catfee_prod_api_secret'),
  catfeeNileApiBaseUrl: varchar('catfee_nile_api_base_url', {
    length: 255,
  })
    .notNull()
    .default('https://nile.catfee.io'),
  catfeeNileApiKey: text('catfee_nile_api_key'),
  catfeeNileApiSecret: text('catfee_nile_api_secret'),
  catfeeAutoActivate: boolean('catfee_auto_activate').notNull().default(true),
  orderPaymentTtlMinutes: integer('order_payment_ttl_minutes')
    .notNull()
    .default(10),
  telegramPollingIntervalSeconds: integer('telegram_polling_interval_seconds')
    .notNull()
    .default(2),
  workerIntervalSeconds: integer('worker_interval_seconds')
    .notNull()
    .default(60),
  minTrxReserveSun: numeric('min_trx_reserve_sun', {
    precision: 20,
    scale: 0,
  })
    .notNull()
    .default('0'),
  bitcartApiBaseUrl: varchar('bitcart_api_base_url', { length: 255 }),
  bitcartAdminBaseUrl: varchar('bitcart_admin_base_url', { length: 255 }),
  bitcartApiToken: text('bitcart_api_token'),
  bitcartStoreId: varchar('bitcart_store_id', { length: 128 }),
  bitcartCurrency: varchar('bitcart_currency', { length: 32 })
    .notNull()
    .default('TRX'),
  bitcartWebhookBaseUrl: varchar('bitcart_webhook_base_url', { length: 255 }),
  bitcartWebhookSecret: text('bitcart_webhook_secret'),
  ...timestamps,
});

// Role 表
export const roleTable = pgTable('role', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  roleName: varchar('role_name', { length: 255 }).notNull(), // 角色名称
  roleDesc: varchar('role_desc', { length: 255 }), // 可选的角色描述
  ...timestamps,
});

export const departmentTable = pgTable('department', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  fatherId: integer('father_id'), // fatherId 字段
  departmentName: varchar('department_name', { length: 255 }), // departmentName 字段
  orderNum: integer('order_num'), // orderNum 字段
  state: boolean().default(true), // state 字段，默认值为 true
  ...timestamps,
});

// Menu 表
export const menuTable = pgTable('menu', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  fatherId: integer('father_id').notNull(), // 父级菜单 ID
  menuName: varchar('menu_name', { length: 255 }).notNull(), // 菜单名称
  menuType: varchar('menu_type', { length: 100 }).notNull(), // 菜单类型
  alIcon: varchar('al_icon', { length: 255 }), // 可选的阿里图标
  icon: varchar({ length: 255 }), // 可选的图标
  path: varchar({ length: 255 }), // 路径
  code: varchar({ length: 100 }).notNull(), // 代码
  orderNum: integer('order_num').notNull(), // 排序号
  status: boolean().default(true), // 状态
  newLinkFlag: boolean('new_link_flag').default(false), // 新链接标志
  visible: boolean().default(true), // 是否可见
  ...timestamps,
});

// SysRolePerm 表
export const sysRolePermTable = pgTable('sys_role_perm', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  roleId: integer('role_id').notNull(), // 角色 ID
  permCode: varchar('perm_code', { length: 255 }).notNull(), // 权限码
  ...timestamps,
});

// SysUserRole 表
export const sysUserRoleTable = pgTable('sys_user_role', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  roleId: integer('role_id').notNull(), // 角色 ID
  userId: integer('user_id').notNull(), // 用户 ID
  ...timestamps,
});

// ============================================================================
// 子系统 A：License 颁发与客户管理
// ----------------------------------------------------------------------------
// 用于 Bot-as-a-Service 自托管模式：内部销售在后台创建客户后，系统生成
// license key + secret，客户用一键脚本去自己的 VPS 拉起 energybot 服务，
// 服务端据此追踪每个客户的 license 状态（是否吊销、是否停用客户）。
// ============================================================================

// 客户表
export const customersTable = pgTable('customers', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 120 }).notNull(), // 客户名称（必填，2-120 字符）
  contact: varchar({ length: 255 }), // 联系方式：Telegram / 邮箱 / 电话等自由文本
  remark: text(), // 备注（合同号、销售负责人等）
  status: varchar({ length: 32 }).notNull().default('active'), // active | suspended
  createdBy: integer('created_by').notNull(), // 创建操作员 user.id
  ...timestamps,
});

// License 表（一个客户可有多个历史 license，只有 revokedAt 为空的才生效）
export const licensesTable = pgTable('licenses', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  customerId: integer('customer_id').notNull(), // 外键→customers.id
  licenseKey: varchar('license_key', { length: 64 }).notNull().unique(), // ebt_<base58> 明文
  secretCipher: varchar('secret_cipher', { length: 200 }).notNull(), // AES-256-GCM(iv||ct||tag) 的 base64
  issuedAt: timestamp('issued_at').defaultNow().notNull(), // 发放时刻
  revokedAt: timestamp('revoked_at'), // 吊销时刻；NULL=有效
  revokedReason: varchar('revoked_reason', { length: 255 }), // 吊销原因
  issuedBy: integer('issued_by').notNull(), // 发放操作员 user.id
  lastSeenAt: timestamp('last_seen_at'), // 客户端最近一次 precheck 成功时刻
  ...timestamps,
});
