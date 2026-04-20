FROM node:22-slim AS build

RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY packages/client/package.json packages/client/tsconfig.json packages/client/
COPY packages/server/package.json packages/server/tsconfig.json packages/server/

RUN pnpm install --frozen-lockfile

COPY packages/shared/src packages/shared/src
COPY packages/client/src packages/client/src
COPY packages/client/index.html packages/client/
COPY packages/client/vite.config.ts packages/client/
COPY packages/server/src packages/server/src

RUN pnpm --filter @twnr/shared run build \
 && pnpm --filter @twnr/client run build \
 && pnpm --filter @twnr/server run build

# --- production image ---
FROM node:22-slim

RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/

RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/client/dist packages/client/dist
COPY --from=build /app/packages/server/dist packages/server/dist
COPY packages/server/scripts packages/server/scripts
COPY packages/server/config /app/config
COPY docker-entrypoint.sh /app/

EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "packages/server/dist/server.js"]
