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

CREATE UNIQUE INDEX IF NOT EXISTS uq_bot_runtime_status_scope_agent
  ON public.bot_runtime_status (bot_scope, coalesce(agent_id, 0));

CREATE INDEX IF NOT EXISTS idx_bot_runtime_status_last_heartbeat
  ON public.bot_runtime_status (last_heartbeat_at);
