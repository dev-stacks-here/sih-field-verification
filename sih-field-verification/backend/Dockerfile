# Field Verification System - Node.js Backend API
FROM node:20-bookworm-slim AS base

# Install build dependencies for native C++ modules (better-sqlite3, sharp)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency definitions
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy application source code
COPY . .

# Ensure storage directories exist
RUN mkdir -p /app/data /app/uploads /app/keys

# Declare persistent volumes for database, cryptographic keypair, and image storage
VOLUME ["/app/data", "/app/uploads", "/app/keys"]

ENV PORT=4000
ENV NODE_ENV=production

EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 4000) + '/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
