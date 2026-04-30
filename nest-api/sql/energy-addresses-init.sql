CREATE TABLE IF NOT EXISTS public.energy_user_addresses (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_id integer,
  telegram_chat_id bigint NOT NULL,
  label varchar(64) NOT NULL,
  address varchar(128) NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  status varchar(32) NOT NULL DEFAULT 'active',
  remark text,
  updated_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp
);

ALTER TABLE public.energy_user_addresses
  ADD COLUMN IF NOT EXISTS agent_id integer;

CREATE INDEX IF NOT EXISTS idx_energy_user_addresses_chat_id
  ON public.energy_user_addresses (telegram_chat_id);

CREATE INDEX IF NOT EXISTS idx_energy_user_addresses_agent_id
  ON public.energy_user_addresses (agent_id);

CREATE INDEX IF NOT EXISTS idx_energy_user_addresses_address
  ON public.energy_user_addresses (address);

DROP INDEX IF EXISTS public.uq_energy_user_addresses_active_address;

CREATE UNIQUE INDEX IF NOT EXISTS uq_energy_user_addresses_active_agent_address
  ON public.energy_user_addresses (coalesce(agent_id, 0), telegram_chat_id, lower(address))
  WHERE deleted_at IS NULL AND status = 'active';

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
SELECT parent.id, U&'\5730\5740\7BA1\7406', 'C', NULL, 'environment', '/default/energy-rental/address-management', 'default:energy-rental:addresses', 4, true, false, true
FROM public.menu parent
WHERE parent.code = 'default:energy-rental'
  AND NOT EXISTS (
    SELECT 1 FROM public.menu m WHERE m.code = 'default:energy-rental:addresses'
  );

UPDATE public.menu
SET menu_name = CASE code
  WHEN 'default:energy-rental:addresses' THEN U&'\5730\5740\7BA1\7406'
  ELSE menu_name
END,
order_num = CASE code
  WHEN 'default:energy-rental:dashboard' THEN 1
  WHEN 'default:energy-rental:platform-config' THEN 2
  WHEN 'default:energy-rental:packages' THEN 3
  WHEN 'default:energy-rental:addresses' THEN 4
  WHEN 'default:energy-rental:orders' THEN 5
  WHEN 'default:energy-rental:wallet-transactions' THEN 6
  WHEN 'default:energy-rental:return-tasks' THEN 7
  ELSE order_num
END
WHERE code IN (
  'default:energy-rental:dashboard',
  'default:energy-rental:platform-config',
  'default:energy-rental:packages',
  'default:energy-rental:addresses',
  'default:energy-rental:orders',
  'default:energy-rental:wallet-transactions',
  'default:energy-rental:return-tasks'
);

INSERT INTO public.sys_role_perm (role_id, perm_code)
SELECT 1, 'default:energy-rental:addresses'
WHERE EXISTS (SELECT 1 FROM public.role WHERE id = 1)
  AND NOT EXISTS (
    SELECT 1
    FROM public.sys_role_perm rp
    WHERE rp.role_id = 1 AND rp.perm_code = 'default:energy-rental:addresses'
  );
