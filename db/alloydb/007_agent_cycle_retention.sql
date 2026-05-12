create table if not exists agent_cycle_artifacts (
  id uuid primary key,
  cycle_id bigint not null references agent_cycles(id) on delete cascade,
  artifact_scope text not null check (
    artifact_scope in (
      'RESEARCH_PLAN',
      'RESEARCH_PACKET',
      'DECISION_CONTEXT',
      'DECISION_OUTPUT',
      'BROKER_EXECUTION',
      'BROKER_STATE',
      'RUNTIME_FAILURE'
    )
  ),
  artifact_key text not null,
  storage_tier text not null check (
    storage_tier in ('HOT', 'COLD')
  ),
  summary text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, artifact_scope, artifact_key)
);

create index if not exists agent_cycle_artifacts_cycle_scope_created_at_idx
  on agent_cycle_artifacts (cycle_id, artifact_scope, created_at desc);

create index if not exists agent_cycle_artifacts_storage_tier_created_at_idx
  on agent_cycle_artifacts (storage_tier, created_at desc);
