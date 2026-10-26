# syntax=docker/dockerfile:1
FROM node:24.22.1-alpine@sha256:6a1c190e17215d844926b0677f4bf87273ff7d5e54db06d3b5b5863ab0b09a3d

ARG REMOTE_ACCESS_VERSION=0.1.2
WORKDIR /opt/eduwork-remote
# Install the published relay at build time; startup never downloads packages.
RUN npm install --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund \
      --save-exact "@eduwork/dsh-remote-access@${REMOTE_ACCESS_VERSION}" \
    && npm cache clean --force
COPY healthcheck.mjs ./healthcheck.mjs

ENV HOST=0.0.0.0 PORT=8787 NODE_ENV=production
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "/opt/eduwork-remote/healthcheck.mjs"]
CMD ["node", "/opt/eduwork-remote/node_modules/@eduwork/dsh-remote-access/lib/relay.js"]
