ALTER TABLE public.agent_bot_configs
  ADD COLUMN IF NOT EXISTS welcome_text text,
  ADD COLUMN IF NOT EXISTS message_config text,
  ADD COLUMN IF NOT EXISTS menu_config text;

ALTER TABLE public.energy_platform_config
  ADD COLUMN IF NOT EXISTS welcome_text text,
  ADD COLUMN IF NOT EXISTS message_config text,
  ADD COLUMN IF NOT EXISTS menu_config text;
