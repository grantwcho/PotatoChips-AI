create table if not exists agent_allocation_events (
  id uuid primary key,
  cycle_id bigint references agent_cycles(id) on delete set null,
  agent_id text not null references agents(id) on delete cascade,
  previous_allocation_usd numeric(18, 2),
  new_allocation_usd numeric(18, 2) not null,
  rationale text not null default '',
  inputs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists agent_allocation_events_agent_id_created_at_idx
  on agent_allocation_events (agent_id, created_at desc);

create index if not exists agent_allocation_events_cycle_id_created_at_idx
  on agent_allocation_events (cycle_id, created_at desc);

update agents
set current_allocation_usd = null,
    updated_at = now()
where id in ('AGT-MACRO-001', 'AGT-EVENT-001', 'AGT-SENT-001')
  and current_allocation_usd in (4500000, 3500000, 3000000);
