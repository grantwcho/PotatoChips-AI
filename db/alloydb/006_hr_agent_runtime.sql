create table if not exists hr_agent_applications (
  id text primary key,
  submitter_key text not null,
  agent_name text not null,
  status text not null check (
    status in (
      'Quarantine',
      'Security scan',
      'Conformance',
      'Paper sim',
      'Shadow',
      'Hired',
      'Rejected'
    )
  ),
  current_stage text not null check (
    current_stage in (
      'stage1-quarantine',
      'stage2-security',
      'stage3-conformance',
      'stage4-paper-sim',
      'stage5-shadow'
    )
  ),
  protected boolean not null default false,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  application_payload jsonb not null default '{}'::jsonb
);

create index if not exists hr_agent_applications_submitted_at_idx
  on hr_agent_applications (submitted_at desc);

create index if not exists hr_agent_applications_status_updated_at_idx
  on hr_agent_applications (status, updated_at desc);

create index if not exists hr_agent_applications_submitter_key_submitted_at_idx
  on hr_agent_applications (submitter_key, submitted_at desc);

create table if not exists hr_agent_events (
  id uuid primary key,
  application_id text not null references hr_agent_applications(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'SUBMITTED',
      'STAGE_ENQUEUED',
      'STAGE_STARTED',
      'STAGE_COMPLETED',
      'STAGE_FAILED',
      'DECISION_READY',
      'DECISION_APPROVED',
      'DECISION_OVERRIDDEN'
    )
  ),
  stage_key text check (
    stage_key is null or stage_key in (
      'stage1-quarantine',
      'stage2-security',
      'stage3-conformance',
      'stage4-paper-sim',
      'stage5-shadow'
    )
  ),
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists hr_agent_events_application_created_at_idx
  on hr_agent_events (application_id, created_at desc);

create index if not exists hr_agent_events_created_at_idx
  on hr_agent_events (created_at desc);
