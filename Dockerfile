FROM node:20-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
COPY scripts ./scripts
COPY prisma ./prisma
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS pydeps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*
COPY agents ./agents
RUN python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/venv/bin/pip install --no-cache-dir \
    ./agents/agt_statarb_001 \
    ./agents/agt_trend_001 \
    ./agents/agt_vol_001

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=8080
ENV PYTHONUNBUFFERED=1
ENV GPTCAPITAL_AGENT_STATE_DIR=/tmp/gptcapital-agent-state
ENV PATH=/opt/venv/bin:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends git python3 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/agents ./agents
COPY --from=pydeps /opt/venv /opt/venv

EXPOSE 8080

CMD ["node", "server.js"]
