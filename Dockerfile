FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm ci && npm run build && npm prune --omit=dev

FROM node:20-alpine

RUN apk add --no-cache curl

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4590
ENV HOME=/app/data

RUN addgroup -S turing && adduser -S -G turing -h /app/data turing && mkdir -p /app/data && chown -R turing:turing /app

COPY --from=builder --chown=turing:turing /app/package.json ./package.json
COPY --from=builder --chown=turing:turing /app/node_modules ./node_modules
COPY --from=builder --chown=turing:turing /app/dist ./dist

EXPOSE 4590
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS "http://localhost:${PORT:-4590}/health" || exit 1

USER turing

CMD ["node", "dist/index.js"]
