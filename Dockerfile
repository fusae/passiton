FROM node:20-alpine

RUN apk add --no-cache curl

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4590
ENV HOME=/app/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY dist/ ./dist/

EXPOSE 4590
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS "http://localhost:${PORT:-4590}/health" || exit 1

CMD ["node", "dist/index.js"]
