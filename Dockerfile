FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    CHROME_PATH=/usr/bin/chromium \
    CHROME_NO_SANDBOX=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates chromium fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

ENV HOME=/tmp

WORKDIR /app

COPY --chown=node:node package.json ./
COPY --chown=node:node server.js config.js ./
COPY --chown=node:node domain ./domain
COPY --chown=node:node providers ./providers
COPY --chown=node:node public ./public
COPY --chown=node:node services ./services

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
