create table if not exists alpaca_account_snapshots (
  id bigint generated always as identity primary key,
  cycle_id bigint references agent_cycles(id) on delete set null,
  account_id text not null,
  account_status text,
  equity numeric(18, 2),
  cash numeric(18, 2),
  buying_power numeric(18, 2),
  portfolio_value numeric(18, 2),
  long_market_value numeric(18, 2),
  short_market_value numeric(18, 2),
  multiplier text,
  daytrade_count integer,
  pattern_day_trader boolean,
  alpaca_request_id text,
  raw_payload jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now()
);

create index if not exists alpaca_account_snapshots_captured_at_idx
  on alpaca_account_snapshots (captured_at desc);

create table if not exists alpaca_position_snapshots (
  id bigint generated always as identity primary key,
  account_snapshot_id bigint not null references alpaca_account_snapshots(id) on delete cascade,
  symbol text not null,
  side text,
  qty numeric(28, 10),
  avg_entry_price numeric(28, 10),
  market_value numeric(28, 10),
  cost_basis numeric(28, 10),
  unrealized_pl numeric(28, 10),
  current_price numeric(28, 10),
  exchange text,
  asset_class text,
  raw_payload jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now()
);

create index if not exists alpaca_position_snapshots_account_snapshot_idx
  on alpaca_position_snapshots (account_snapshot_id, symbol);

create table if not exists alpaca_orders (
  id uuid primary key,
  cycle_id bigint references agent_cycles(id) on delete set null,
  agent_id text references agents(id) on delete set null,
  broker_order_id text not null unique,
  client_order_id text,
  symbol text not null,
  side text not null,
  order_type text not null,
  time_in_force text not null,
  qty numeric(28, 10),
  notional numeric(28, 10),
  filled_qty numeric(28, 10),
  filled_avg_price numeric(28, 10),
  status text not null,
  submitted_reasoning text not null default '',
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  alpaca_request_id text,
  submitted_at timestamptz,
  updated_at timestamptz
);

create index if not exists alpaca_orders_cycle_id_idx
  on alpaca_orders (cycle_id, submitted_at desc);
create index if not exists alpaca_orders_agent_id_idx
  on alpaca_orders (agent_id, submitted_at desc);
create index if not exists alpaca_orders_status_idx
  on alpaca_orders (status, updated_at desc);
