# SPDX-License-Identifier: AGPL-3.0-or-later
# Saucepenny container image: builds the static site and serves it with a tiny Node
# server (no other runtime dependencies). Publish the port on the host loopback, e.g.
#   docker build -t saucepenny . && docker run --rm -p 127.0.0.1:4893:4893 saucepenny
# then open http://127.0.0.1:4893/

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json .npmrc ./
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
COPY packages/web/package.json packages/web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
# Only the built site, the static server and the licence texts are shipped.
COPY --from=build /app/packages/web/dist ./site
COPY --from=build /app/packages/cli/src/serve.ts ./serve.ts
COPY --from=build /app/LICENSE /app/NOTICE /app/THIRD_PARTY_NOTICES.md ./
# Inside the container the server listens on all interfaces so the port can be
# forwarded; keep the published port on 127.0.0.1 unless you mean to share it.
ENV SAUCEPENNY_DIST=/app/site \
    SAUCEPENNY_HOST=0.0.0.0 \
    SAUCEPENNY_PORT=4893
USER node
EXPOSE 4893
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:4893/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "serve.ts"]
