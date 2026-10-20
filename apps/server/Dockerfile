FROM node:24.18.0-bookworm-slim AS build
WORKDIR /src
ENV CI=1
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @openmeet/shared build && pnpm --filter @openmeet/server build
# ADR 0014: the web client is the desktop frontend built with the web target, served by the API.
RUN pnpm --filter @openmeet/media build && pnpm --filter @openmeet/desktop build:web
RUN pnpm --filter @openmeet/server deploy --legacy --prod /out && cp -r apps/desktop/dist-web /out/web

FROM node:24.18.0-bookworm-slim
WORKDIR /app
COPY --from=build /out /app
COPY apps/server/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod 755 /app/docker-entrypoint.sh && chown -R node:node /app
USER node
EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
