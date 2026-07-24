# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Install production dependencies
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

WORKDIR /app

# Copy package manifest and install ALL dependencies (including devDeps)
COPY package.json ./
RUN corepack enable && \
    corepack prepare pnpm@latest --activate && \
    pnpm install

# Copy source code
COPY tsconfig.json ./
COPY src/ src/
COPY prisma/ prisma/

# Generate Prisma client and build TypeScript
RUN npx prisma generate && \
    pnpm run build

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
    adduser --system --uid 1001 appuser

# Copy production dependencies from deps stage
COPY --from=deps --chown=appuser:nodejs /app/node_modules ./node_modules

# Copy built artifacts from builder stage
COPY --from=builder --chown=appuser:nodejs /app/dist ./dist
COPY --from=builder --chown=appuser:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=appuser:nodejs /app/prisma ./prisma

# Copy OpenAPI docs
COPY --from=builder --chown=appuser:nodejs /app/src/docs ./dist/docs

# Switch to non-root user
USER appuser

# Service port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

# Start the application
CMD ["node", "dist/index.js"]
