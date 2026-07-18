FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    CHROME_PATH=/usr/bin/chromium

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates chromium fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

ARG GIT_COMMIT_SHA=unknown
ARG GIT_COMMIT_DATE=
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA} \
    GIT_COMMIT_DATE=${GIT_COMMIT_DATE}

ENV HOME=/tmp

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node server.js config.js build-info.js ./
COPY --chown=node:node domain ./domain
COPY --chown=node:node providers ./providers
COPY --chown=node:node public ./public
COPY --chown=node:node services ./services

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
