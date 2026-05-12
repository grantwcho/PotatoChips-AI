## Potato Chips AI Web App

This application is the operator and customer surface for Potato Chips AI, an
AI-native financial research platform built on Google Cloud.

## Target platform

The agreed target architecture for this product is:

- Identity Platform for customer authentication
- Cloud Run for the web app, APIs, and agent workers
- AlloyDB as the transactional system of record
- BigQuery for analytics, research, and audit
- Pub/Sub, Cloud Tasks, and Workflows for agent orchestration
- Secret Manager, Audit Logs, and VPC Service Controls for security

## Current migration status

The repository is not fully on that target stack yet.

- Customer authentication now uses Identity Platform email and password flows,
  including password reset emails.
- User profile records still live in Firestore as a temporary store until the
  AlloyDB-backed transactional model is enabled in the environment.
- Most dashboard data is still mock data while the core research services are
  built out.

This README describes the target platform and the remaining migration boundary
so the repo no longer presents Firebase and Firestore as the long-term design.

## Service map

- Identity: Identity Platform
- Runtime: Cloud Run
- Transactions: AlloyDB
- Analytics and audit: BigQuery
- Events: Pub/Sub
- Controlled async execution: Cloud Tasks
- Multi-step orchestration: Workflows
- Secrets: Secret Manager
- Guardrails and forensics: Audit Logs and VPC Service Controls

More detail lives in [docs/target-architecture.md](./docs/target-architecture.md).

## Environment scaffold

Use [env.example](./env.example) as the starting point for local setup.

The env scaffold includes:

- Target Google Cloud settings for Identity Platform, Cloud Run, AlloyDB,
  BigQuery, orchestration, and security
- A temporary Firestore compatibility block for user data that has not moved to
  AlloyDB yet

## Local development

1. Copy `env.example` to `.env.local`.
2. Set `IDENTITY_PLATFORM_API_KEY` and `IDENTITY_PLATFORM_PROJECT_ID`, enable
   the Identity Toolkit API for the project, then enable the Email/Password
   provider in your Identity Platform tenant or project so customer logins can
   create server-side sessions.
3. Choose a user store backend:
   Set `APP_USER_STORE_BACKEND=alloydb` and provide `DATABASE_URL` after
   applying [site/db/alloydb/001_initial_schema.sql](/Users/grantcho/Documents_Local/GPTCapital/site/db/alloydb/001_initial_schema.sql).
   HR-specific AlloyDB migrations are applied automatically when the HR pipeline
   first touches the database, so local recruiting intake won't stay stuck on an
   outdated `hr_agent_applications` status constraint.
   Or keep `APP_USER_STORE_BACKEND=firestore` and populate the
   `FIRESTORE_COMPATIBILITY_*` credentials for the temporary compatibility path.
4. If you want the research-agent runtime to make structured decisions locally,
   set at least one decision-model credential: `OPENAI_API_KEY` or
   `ANTHROPIC_API_KEY`.
5. If you only need to preview the customer portal UI locally, set
   `DEV_DASHBOARD_BYPASS=true` in `.env.local`. This bypass is only honored
   during `npm run dev`, so production builds and Cloud Run still require a
   real customer session.
6. Start the app with `npm run dev`.

## Cloud Run deployment

Deploy the app to Cloud Run with a dedicated runtime service account, Secret
Manager bindings, and least-privilege access to the services it needs.

At minimum, the runtime should be able to:

- read application secrets from Secret Manager
- connect to AlloyDB or Cloud SQL infrastructure used for local parity
- publish to Pub/Sub topics and enqueue Cloud Tasks
- invoke approved Workflows
- write operational logs for downstream audit analysis

## Unattended worker

The dashboard is not the long-term runtime driver. For unattended research
workflows, deploy the Cloud Run service with:

- `APP_USER_STORE_BACKEND=alloydb`
- `DATABASE_URL` pointing at the AlloyDB runtime database
- `AGENT_WORKER_SECRET` set to a strong shared secret
- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` configured so agent decisioning can run
- `CLOUD_TASKS_AGENT_QUEUE` set to the full queue resource name
- `AGENT_AUTONOMOUS_LOOP_ENABLED=true` after the queue is ready

Then trigger the protected worker endpoint from backend infrastructure instead
of a browser tab:

- `POST /api/agents/worker?key=$AGENT_WORKER_SECRET`

This route runs the research cycle on the server and returns the cycle result as
JSON. It also accepts Pub/Sub push envelopes, which makes it suitable as a push
subscription target when you are ready to move cycle triggers behind Pub/Sub or
Cloud Tasks.

When `AGENT_AUTONOMOUS_LOOP_ENABLED=true`, each successful worker run enqueues
the next Cloud Task automatically. Use conservative queue settings for the
runtime queue so the swarm does not overlap itself:

- `max dispatches per second`: `1`
- `max concurrent dispatches`: `1`
- `max attempts`: `10`

For testing, you can force the full desk awake outside the normal market
schedule with:

- `AGENT_FORCE_ALL_ACTIVE=true`

This keeps every agent eligible to think, converse, and answer directed desk
requests during overnight and off-market windows. It does not change market
hours, and it does not enable any external execution workflow when
`orderExecutionEnabled` is otherwise off.

## Migration priorities

1. Apply the AlloyDB schema and switch `APP_USER_STORE_BACKEND=alloydb`.
2. Migrate existing customer and operator records from Firestore into AlloyDB.
3. Split operational data and analytical/audit data between AlloyDB and
   BigQuery.
4. Move agent workflows behind Pub/Sub, Cloud Tasks, and Workflows with
   explicit quality and approval gates.
5. Tighten production security around Secret Manager, Audit Logs, and
   VPC Service Controls.
