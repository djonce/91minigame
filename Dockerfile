FROM node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 APP_ROOT=/app CATALOG_PATH=/data/games.json VERIFICATION_DIR=/data/verification
COPY --chown=node:node package.json ./
RUN npm install --omit=dev --ignore-scripts --no-package-lock
COPY --chown=node:node build/ ./build/
COPY --chown=node:node dist/ ./dist/
COPY --chown=node:node config/runtime-lock.json ./config/runtime-lock.json
COPY --chown=node:node .runtime/emulatorjs/4.2.3/ ./.runtime/emulatorjs/4.2.3/
COPY --chown=node:node scripts/verify-runtime.mjs ./scripts/verify-runtime.mjs
COPY --chown=node:node THIRD_PARTY_NOTICES.md ./
RUN node scripts/verify-runtime.mjs
USER node
EXPOSE 8080
CMD ["node", "build/server/index.js"]
