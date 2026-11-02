# PubCrawl MCP server, Streamable HTTP transport.
#
#   docker build -t pubcrawl .
#   docker run --rm -p 8080:8080 pubcrawl
#   curl http://localhost:8080/health
#
# Serves POST /mcp and GET /health on $PORT (8080 here; Cloud Run and most
# platforms set PORT themselves). See "Run in your own environment" in README.md.

FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-slim
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/http.js"]
