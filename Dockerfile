# --- Build stage ---
FROM node:20-alpine AS builder
WORKDIR /app

# needed for next/image (sharp) on alpine
RUN apk add --no-cache libc6-compat

# Install deps using whichever lockfile you have
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
RUN \
  if [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then npm i -g pnpm && pnpm i --frozen-lockfile; \
  elif [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  else npm i; fi

# Copy source and build (you already set output:'standalone' in next.config)
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- Runtime stage ---
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# App Runner will inject PORT=8080; we honor it
ENV PORT=8080
ENV HOSTNAME=0.0.0.0  

# Standalone output includes server.js + minimal node_modules
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 8080
CMD ["node", "server.js"]
