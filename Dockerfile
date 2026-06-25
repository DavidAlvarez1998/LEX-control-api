# syntax=docker/dockerfile:1

###############################################################################
# build — install ALL deps, generate the Prisma client, compile TS -> dist
###############################################################################
FROM node:22-alpine AS build
WORKDIR /app

# pnpm via corepack (lockfile is v9 -> pnpm 9)
RUN corepack enable && corepack prepare pnpm@9 --activate

# Manifest + lockfile first so the install layer is cached across source changes
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Generate the typed Prisma client. `generate` reads only schema.prisma; it does
# NOT connect to the database, so no DATABASE_URL is needed at build time. Built
# on alpine so the engine target (linux-musl-openssl-3.0.x) matches the runtime.
COPY prisma ./prisma
RUN pnpm generate

# Compile the API (tsc -> dist)
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

###############################################################################
# runtime — slim, non-root, tini as PID 1 so the server's SIGTERM/SIGINT handler runs
###############################################################################
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Prisma's query engine needs OpenSSL on Alpine; tini forwards signals to Node
RUN apk add --no-cache openssl ca-certificates tini

# pnpm's symlinked layout keeps the generated Prisma client under node_modules/.pnpm,
# so copy the whole tree from the build stage (no separate prod-deps stage).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist         ./dist
# prisma/ carries schema.prisma + seed-tipos.json (seed-catalogo reads it via __dirname)
COPY --from=build /app/prisma       ./prisma
COPY package.json ./

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
