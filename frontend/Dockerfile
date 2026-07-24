# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Install dependencies
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
LABEL stage=deps

WORKDIR /app

# Copy package manifest (no lockfile in subdirectory — pnpm will generate one)
COPY package.json ./
RUN corepack enable && \
    corepack prepare pnpm@latest --activate && \
    pnpm install --prod

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Build application
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
LABEL stage=builder

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_STELLAR_NETWORK
ARG NEXT_PUBLIC_RPC_URL
ARG NEXT_PUBLIC_STELLAR_RPC_URL
ARG NEXT_PUBLIC_CONTRACT_ID
ARG NEXT_PUBLIC_FREIGHTER_ENABLED
ARG NEXT_PUBLIC_ALBEDO_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG PINATA_GATEWAY_URL

WORKDIR /app

# Copy package manifest and install ALL dependencies
COPY package.json ./
RUN corepack enable && \
    corepack prepare pnpm@latest --activate && \
    pnpm install

# Copy source code and config
COPY tsconfig.json next.config.ts ./
COPY public/ public/
COPY src/ src/

# Build Next.js application (NEXT_PUBLIC_* vars are inlined at build time)
RUN pnpm run build

# Remove devDependencies after build
RUN pnpm prune --prod

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: Production runtime image
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
LABEL stage=runner

WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy production node_modules (with Next.js runtime)
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules

# Copy built application
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./
COPY --from=builder --chown=nextjs:nodejs /app/next.config.ts ./

# Switch to non-root user
USER nextjs

# Service port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

# Start Next.js server
ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
CMD ["npx", "next", "start"]
