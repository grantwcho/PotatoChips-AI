create table if not exists agent_learning_reviews (
  id uuid primary key,
  agent_id text references agents(id) on delete cascade,
  cadence text not null check (
    cadence in (
      'DAILY_SIGNAL_TRACK',
      'WEEKLY_SELF_REVIEW',
      'MONTHLY_PARAMETER_OPTIMIZATION',
      'QUARTERLY_DEEP_REVIEW'
    )
  ),
  review_date date not null,
  review_window_start timestamptz not null,
  review_window_end timestamptz not null,
  status text not null default 'COMPLETED' check (
    status in ('COMPLETED', 'SKIPPED')
  ),
  summary text not null default '',
  metrics jsonb not null default '{}'::jsonb,
  findings jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists agent_learning_reviews_unique_idx
  on agent_learning_reviews (coalesce(agent_id, '__GLOBAL__'), cadence, review_date);

create index if not exists agent_learning_reviews_agent_id_created_at_idx
  on agent_learning_reviews (agent_id, created_at desc);

create table if not exists agent_lessons (
  id uuid primary key,
  agent_id text not null references agents(id) on delete cascade,
  created_by_review_id uuid references agent_learning_reviews(id) on delete set null,
  lesson_key text not null,
  title text not null,
  lesson_text text not null,
  memory_scope text not null check (
    memory_scope in ('GLOBAL', 'REGIME', 'SYMBOL_CLUSTER', 'EXECUTION')
  ),
  bias_direction text not null check (
    bias_direction in ('INCREASE', 'DECREASE', 'AVOID', 'PREFER', 'OBSERVE')
  ),
  source_type text not null check (
    source_type in ('REALIZED_OUTCOME', 'BACKTEST', 'HUMAN_REVIEW', 'SYSTEM_REVIEW')
  ),
  status text not null default 'ACTIVE' check (
    status in ('ACTIVE', 'CANDIDATE', 'RETIRED', 'REJECTED', 'CONFLICT')
  ),
  contradiction_status text not null default 'NONE' check (
    contradiction_status in ('NONE', 'CONFLICTING', 'SUPERSEDED')
  ),
  confidence_score integer not null default 50 check (
    confidence_score between 0 and 100
  ),
  sample_size integer,
  weight numeric(9, 4) not null default 0.5,
  affected_regimes jsonb not null default '[]'::jsonb,
  evidence_window_start timestamptz,
  evidence_window_end timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_lessons_agent_id_status_created_at_idx
  on agent_lessons (agent_id, status, created_at desc);

create index if not exists agent_lessons_review_idx
  on agent_lessons (created_by_review_id);

create table if not exists agent_parameter_versions (
  id uuid primary key,
  agent_id text not null references agents(id) on delete cascade,
  promoted_by_review_id uuid references agent_learning_reviews(id) on delete set null,
  parameter_key text not null,
  parameter_type text not null check (
    parameter_type in ('NUMBER', 'INTEGER', 'BOOLEAN', 'ENUM')
  ),
  value_number numeric(18, 6),
  value_integer integer,
  value_boolean boolean,
  value_text text,
  min_value numeric(18, 6),
  max_value numeric(18, 6),
  max_step_pct numeric(9, 4) not null default 0.10,
  change_direction text not null default 'NONE' check (
    change_direction in ('NONE', 'INCREASE', 'DECREASE')
  ),
  status text not null default 'ACTIVE' check (
    status in ('ACTIVE', 'SUPERSEDED', 'REJECTED')
  ),
  reasoning text not null default '',
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists agent_parameter_versions_active_idx
  on agent_parameter_versions (agent_id, parameter_key)
  where status = 'ACTIVE';

create index if not exists agent_parameter_versions_agent_key_created_at_idx
  on agent_parameter_versions (agent_id, parameter_key, created_at desc);

create table if not exists agent_short_term_memory (
  agent_id text primary key references agents(id) on delete cascade,
  memory_date date not null,
  memory_payload jsonb not null default '{}'::jsonb,
  reset_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists agent_short_term_memory_memory_date_idx
  on agent_short_term_memory (memory_date desc);

create table if not exists agent_signal_outcomes (
  id uuid primary key,
  agent_id text not null references agents(id) on delete cascade,
  cycle_id bigint references agent_cycles(id) on delete set null,
  review_id uuid references agent_learning_reviews(id) on delete set null,
  broker_order_id text,
  client_order_id text,
  symbol text,
  side text,
  signal_type text not null,
  evaluation_horizon text not null check (
    evaluation_horizon in ('INTRADAY', 'ONE_DAY', 'THREE_DAY', 'ONE_WEEK', 'EVENT_WINDOW')
  ),
  outcome_status text not null default 'PENDING' check (
    outcome_status in ('PENDING', 'RESOLVED')
  ),
  outcome_type text not null check (
    outcome_type in (
      'ACCEPTED',
      'FILLED',
      'PARTIALLY_FILLED',
      'REJECTED',
      'CANCELED',
      'OPEN_POSITION',
      'CLOSED_POSITION',
      'EXPIRED'
    )
  ),
  regime text,
  entry_notional numeric(18, 6),
  entry_confidence_score integer check (
    entry_confidence_score between 0 and 100
  ),
  fill_quality_score integer check (
    fill_quality_score between 0 and 100
  ),
  realized_pnl numeric(18, 6),
  unrealized_pnl numeric(18, 6),
  research_topic text,
  expected_window_end timestamptz,
  resolved_at timestamptz,
  resolution_notes text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists agent_signal_outcomes_unique_order_horizon_idx
  on agent_signal_outcomes (coalesce(broker_order_id, ''), coalesce(client_order_id, ''), evaluation_horizon)
  where broker_order_id is not null or client_order_id is not null;

create index if not exists agent_signal_outcomes_agent_id_created_at_idx
  on agent_signal_outcomes (agent_id, created_at desc);

create index if not exists agent_signal_outcomes_outcome_status_idx
  on agent_signal_outcomes (outcome_status, updated_at desc);
