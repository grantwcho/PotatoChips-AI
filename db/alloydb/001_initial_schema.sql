create type app_user_role as enum ('ADMIN', 'INVESTOR', 'OPERATOR');

create table if not exists app_users (
  id uuid primary key,
  identity_subject text not null unique,
  email text not null unique,
  email_verified boolean not null default false,
  display_name text,
  avatar_url text,
  role app_user_role not null default 'INVESTOR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_users_role_idx on app_users (role);

create table if not exists portfolios (
  id uuid primary key,
  code text not null unique,
  name text not null,
  base_currency text not null default 'USD',
  inception_date date,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists portfolio_memberships (
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  mandate text,
  created_at timestamptz not null default now(),
  primary key (portfolio_id, user_id)
);

create table if not exists positions (
  id uuid primary key,
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  symbol text not null,
  asset_class text not null,
  quantity numeric(28, 10) not null,
  average_cost numeric(28, 10) not null,
  market_value numeric(28, 10) not null default 0,
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists positions_portfolio_symbol_idx
  on positions (portfolio_id, symbol);

create table if not exists trade_orders (
  id uuid primary key,
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  requested_by_user_id uuid references app_users(id),
  symbol text not null,
  side text not null,
  order_type text not null,
  quantity numeric(28, 10) not null,
  limit_price numeric(28, 10),
  status text not null default 'PENDING',
  risk_decision text not null default 'UNREVIEWED',
  broker_reference text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trade_orders_status_idx on trade_orders (status);

create table if not exists audit_events (
  id uuid primary key,
  actor_type text not null,
  actor_id text not null,
  event_type text not null,
  resource_type text not null,
  resource_id text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists audit_events_resource_idx
  on audit_events (resource_type, resource_id, occurred_at desc);

create index if not exists audit_events_actor_idx
  on audit_events (actor_type, actor_id, occurred_at desc);
