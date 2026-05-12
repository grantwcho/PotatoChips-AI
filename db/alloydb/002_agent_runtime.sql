create table if not exists agents (
  id text primary key,
  display_name text not null,
  role text not null,
  tier integer not null check (tier between 1 and 3),
  reports_to text,
  strategy_category text,
  status text not null check (
    status in ('ACTIVE', 'PAUSED', 'PAPER', 'EVALUATION', 'OFFLINE')
  ),
  paper_enabled boolean not null default true,
  current_allocation_usd numeric(18, 2),
  max_allocation_usd numeric(18, 2),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agents_tier_idx on agents (tier);
create index if not exists agents_status_idx on agents (status);
create index if not exists agents_strategy_category_idx
  on agents (strategy_category);

create table if not exists agent_configs (
  agent_id text primary key references agents(id) on delete cascade,
  objective_function text not null,
  system_prompt text not null,
  subscriptions jsonb not null default '[]'::jsonb,
  direct_reports jsonb not null default '[]'::jsonb,
  constraints jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists agent_cycles (
  id bigint generated always as identity primary key,
  run_mode text not null check (run_mode in ('PAPER', 'LIVE')),
  market_status text not null,
  regime text,
  summary text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists agent_cycles_run_mode_started_at_idx
  on agent_cycles (run_mode, started_at desc);

create table if not exists agent_messages (
  id uuid primary key,
  cycle_id bigint references agent_cycles(id) on delete set null,
  sender_id text not null references agents(id) on delete cascade,
  recipient_id text,
  message_type text not null,
  priority text not null check (
    priority in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
  ),
  render_type text not null check (
    render_type in ('thought', 'message', 'action', 'alert')
  ),
  content text not null,
  reasoning text not null,
  payload jsonb not null default '{}'::jsonb,
  correlation_id text,
  requires_response boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists agent_messages_created_at_idx
  on agent_messages (created_at desc);
create index if not exists agent_messages_sender_id_idx
  on agent_messages (sender_id, created_at desc);
create index if not exists agent_messages_cycle_id_idx
  on agent_messages (cycle_id, created_at desc);

create table if not exists agent_decisions (
  id uuid primary key,
  cycle_id bigint references agent_cycles(id) on delete set null,
  agent_id text not null references agents(id) on delete cascade,
  related_message_id uuid references agent_messages(id) on delete set null,
  action_taken text not null,
  reasoning text not null,
  data_consumed jsonb not null default '[]'::jsonb,
  confidence_score integer not null check (
    confidence_score between 0 and 100
  ),
  created_at timestamptz not null default now()
);

create index if not exists agent_decisions_agent_id_idx
  on agent_decisions (agent_id, created_at desc);
create index if not exists agent_decisions_cycle_id_idx
  on agent_decisions (cycle_id, created_at desc);

create table if not exists operator_overrides (
  id uuid primary key,
  target_agent_id text references agents(id) on delete set null,
  operator_directive text not null,
  recommendation text,
  action_taken text not null,
  created_at timestamptz not null default now()
);

create index if not exists operator_overrides_created_at_idx
  on operator_overrides (created_at desc);
