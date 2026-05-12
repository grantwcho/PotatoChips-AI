# Potato Chips AI Target Architecture

## Objective

Potato Chips AI is being built as an AI-native financial research platform with
explicit control planes for identity, research workflow quality, audit, and
operator oversight.

The platform target is:

- Identity Platform for customer authentication
- Cloud Run for the product surface and agent services
- AlloyDB for transactional state
- BigQuery for analytics, research, and audit
- Pub/Sub, Cloud Tasks, and Workflows for orchestration
- Secret Manager, Audit Logs, and VPC Service Controls for security

## Architectural principles

- Agents can propose, analyze, and simulate, but deterministic services own
  state transitions and publication workflow.
- Transactional truth and analytical truth live in different systems.
- Every externally meaningful action should leave an audit trail.
- Quality gates and approvals belong in workflows, not in prompt text.
- Learning must be bounded, typed, review-owned, and reversible; agents do not
  freely rewrite their own operating instructions.

## Model routing

- Anthropic is the primary model provider for the live agent stack, with OpenAI
  kept as a fallback if Anthropic credentials are unavailable.
- Desk agents, including research and review sleeves, run on Claude
  Sonnet. This covers the high-frequency loops that generate ideas, react to
  market events, and write decision or discussion logs throughout the session.
- The research coordinator and AI HR evaluation pipeline run on Claude Opus.
  These are lower-frequency, quality-critical decisions around ensemble
  construction, guardrails, replacement logic, wrapped-model evaluation, and
  hiring review.
- Model routing is owned by a central config layer so individual call sites
  declare only their route (`desk`, `cio`, or `hr`) instead of hard-coding
  model strings throughout the codebase.

## Agent memory and learning

- Static memory is the immutable system prompt and role definition stored in
  `agent_configs`.
- Medium-term memory stores promoted lessons and bounded parameter versions that
  persist across sessions and change only through scheduled reviews.
- Short-term memory stores current-day operating context such as active coverage,
  open reviews, attention allocations, and session state, and resets daily.
- Daily, weekly, monthly, and quarterly reviews update learning artifacts at
  different cadences, with anti-oscillation limits, conflict detection, and
  drift checks to prevent degenerate self-modification.

## Service responsibilities

### Identity Platform

- customer authentication
- tenant and user lifecycle
- session and claims issuance
- optional MFA and future multi-tenancy support

### Cloud Run

- Next.js web app
- API endpoints for customer and operator actions
- stateless agent workers
- quality and publication workflow services

### AlloyDB

- customer records
- research portfolios, coverage maps, mandates, approvals, and workflow events
- system-of-record state for operational workflows

### BigQuery

- research outputs
- prompt and model telemetry
- research workflow and quality audit logs
- historical analytics and reporting

### Pub/Sub, Cloud Tasks, and Workflows

- Pub/Sub broadcasts domain events between research services
- Cloud Tasks handles controlled retries, rate limits, and deferred execution
- Workflows manages visible multi-step research processes with checkpoints

### Secret Manager, Audit Logs, and VPC Service Controls

- Secret Manager stores credentials and signing material
- Audit Logs preserves operator and platform activity
- VPC Service Controls reduces data exfiltration risk across sensitive projects

## Suggested control flow

1. Identity Platform authenticates the customer or operator.
2. Cloud Run APIs authorize the request against operational roles and policy.
3. AlloyDB records the transactional state change.
4. Pub/Sub emits downstream events for analytics, monitoring, and agent work.
5. Cloud Tasks and Workflows handle long-running or gated execution.
6. BigQuery receives analytical and audit copies of the relevant events.

## Current implementation gap

Today, the repo still has two compatibility layers:

- customer and operator records still persist in Firestore
- some environments may still point `APP_USER_STORE_BACKEND` at Firestore until
  the AlloyDB schema is applied and data is migrated

These are temporary migration adapters, not the long-term architecture.

## Recommended migration order

1. Apply the AlloyDB schema and point `APP_USER_STORE_BACKEND` to `alloydb`.
2. Migrate the current Firestore compatibility store into AlloyDB and remove it
   from auth/session logic.
3. Send research, telemetry, and audit events to BigQuery instead of relying on
   operational storage.
4. Introduce Pub/Sub event contracts, then move retry and sequencing concerns
   into Cloud Tasks and Workflows.
5. Lock down production with Secret Manager, Audit Logs, and
   VPC Service Controls before expanding production research traffic.
