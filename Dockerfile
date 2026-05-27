# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Sensible container defaults (override at runtime). Bind to all interfaces so
# the SMTP/HTTP ports are reachable from sibling containers.
ENV BIND_HOST=0.0.0.0 \
    SMTP_PORT=2525 \
    HTTP_PORT=3000 \
    DATA_DIR=/data

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

RUN mkdir -p /data && addgroup -S app && adduser -S app -G app && chown -R app /data /app
USER app
VOLUME ["/data"]
EXPOSE 2525 3000

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HTTP_PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
