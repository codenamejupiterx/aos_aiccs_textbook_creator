# --- build stage ---
FROM node:22-bookworm AS builder
WORKDIR /app

# install deps for building
COPY package*.json ./
RUN npm ci

# bring in source
COPY . .

# build next
RUN npm run build

# --- runtime stage ---
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV HOSTNAME=0.0.0.0

# Chromium + shared libs needed by headless chrome
RUN apt-get update && apt-get install -y --no-install-recommends \
  chromium \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libnss3 \
  libnspr4 \
  libxrandr2 \
  libgbm1 \
  libxshmfence1 \
  libdrm2 \
  libpango-1.0-0 \
  libx11-6 \
  libx11-xcb1 \
  libxext6 \
  libxrender1 \
  libglib2.0-0 \
  libexpat1 \
  libxcb1 \
  libdbus-1-3 \
  && rm -rf /var/lib/apt/lists/*

# Puppeteer config
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_DISABLE_HEADLESS_WARNING=1

# install ONLY prod deps in the runner
COPY package*.json ./
COPY tsconfig.json ./          
RUN npm ci --omit=dev

# copy built app from builder
COPY --from=builder /app/.next /app/.next
COPY --from=builder /app/public /app/public
COPY --from=builder /app/src /app/src

EXPOSE 8080
CMD ["npm", "run", "start"]
