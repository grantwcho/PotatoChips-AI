create table if not exists api_activity_events (
  id uuid primary key,
  service text not null,
  category text not null,
  operation text not null,
  http_method text not null,
  url text not null,
  status_code integer,
  duration_ms integer,
  request_headers jsonb not null default '{}'::jsonb,
  request_payload jsonb not null default 'null'::jsonb,
  response_headers jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default 'null'::jsonb,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists api_activity_events_service_created_at_idx
  on api_activity_events (service, created_at desc);

create index if not exists api_activity_events_category_created_at_idx
  on api_activity_events (category, created_at desc);

create index if not exists api_activity_events_created_at_idx
  on api_activity_events (created_at desc);
