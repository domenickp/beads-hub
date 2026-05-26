FROM node:20-bookworm-slim AS builder

WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# ── Production image ──
FROM node:20-bookworm-slim

# Install bd (beads CLI) and age (for SOPS decryption)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates git age \
    build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

# Install beads CLI
RUN curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash \
    || npm install -g @beads/bd

# Install SOPS
RUN curl -fsSL -o /usr/local/bin/sops \
    https://github.com/getsops/sops/releases/download/v3.9.4/sops-v3.9.4.linux.$(dpkg --print-architecture) \
    && chmod +x /usr/local/bin/sops

WORKDIR /app

# Copy production dependencies
COPY package.json ./
RUN npm install --omit=dev

# Copy built frontend and server
COPY --from=builder /app/dist ./dist
COPY server.js ./
COPY src/agents.js src/google.js ./src/

# Entrypoint: decrypt secrets if .env.enc exists, then start
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]
