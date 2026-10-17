FROM node:20-alpine AS deps
# Prisma's query/schema engine binaries need OpenSSL, which isn't present
# on a bare node:20-alpine image -- without it, `prisma generate` silently
# selects a mismatched engine and `prisma migrate` / the running app's own
# queries fail at runtime with "Could not parse schema engine response".
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
RUN pnpm exec prisma generate

FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:20-alpine AS production
# Needed at runtime too: the app's own Prisma Client calls into the same
# engine binary to run queries, not just `prisma generate`/`migrate`.
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S -G app -u 10001 app
# pnpm's node_modules is a content-addressable store (.pnpm/) with symlinks
# into it, not a flat tree -- cherry-picking just the generated Prisma
# client back out of a separate --prod-only install is fragile across
# stages. Simpler and robust: reuse the deps stage's already-installed,
# already-generated node_modules directly (it was a full install, so this
# does carry devDependencies into the final image -- a size/simplicity
# trade-off, not a correctness issue).
#
# Deliberately not --chown=app:app here: the pnpm content-addressable store
# is many thousands of small files/symlinks, and a per-file chown during
# COPY turned this into a many-minutes-long step. The running app doesn't
# need to write into node_modules; root-owned-but-non-writable files are
# fine for a process that only reads them. (Same for dist/ and package.json.)
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER app
EXPOSE 4000
CMD ["node", "dist/index.js"]
