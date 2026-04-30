ALTER TABLE public.agent_recharge_orders
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

UPDATE public.agent_recharge_orders
SET payment_gateway = 'bitcart'
WHERE payment_gateway IS NULL;

CREATE INDEX IF NOT EXISTS idx_agent_recharge_orders_bitcart_invoice_id
  ON public.agent_recharge_orders (bitcart_invoice_id);

ALTER TABLE public.energy_platform_config
  ADD COLUMN IF NOT EXISTS bitcart_api_base_url varchar(255),
  ADD COLUMN IF NOT EXISTS bitcart_admin_base_url varchar(255),
  ADD COLUMN IF NOT EXISTS bitcart_api_token text,
  ADD COLUMN IF NOT EXISTS bitcart_store_id varchar(128),
  ADD COLUMN IF NOT EXISTS bitcart_currency varchar(32) NOT NULL DEFAULT 'TRX',
  ADD COLUMN IF NOT EXISTS bitcart_webhook_base_url varchar(255),
  ADD COLUMN IF NOT EXISTS bitcart_webhook_secret text;

UPDATE public.energy_platform_config
SET bitcart_currency = 'TRX'
WHERE bitcart_currency IS NULL OR btrim(bitcart_currency) = '';

DELETE FROM public.sys_role_perm
WHERE role_id = 1
  AND perm_code = 'default:energy-rental:agent-recharge';

DELETE FROM public.sys_role_perm
WHERE perm_code = 'default:energy-rental:agent-recharge:confirm';

DELETE FROM public.menu
WHERE code = 'default:energy-rental:agent-recharge:confirm';
