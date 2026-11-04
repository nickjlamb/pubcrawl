#!/usr/bin/env node
import "dotenv/config";
import { configureFromEnv, SERVER_VERSION } from "./server.js";
import { createHttpApp, parseAllowedOrigins } from "./http-app.js";

configureFromEnv();

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const allowedOrigins = parseAllowedOrigins(process.env.PUBCRAWL_ALLOWED_ORIGINS);

const usageLog = process.env.PUBCRAWL_USAGE_LOG?.trim().toLowerCase() === "off" ? false : undefined;

const httpServer = createHttpApp({ allowedOrigins, usageLog });

httpServer.listen(PORT, HOST, () => {
  const origins = allowedOrigins === "*" ? "any origin" : allowedOrigins.join(", ");
  console.error(`PubCrawl ${SERVER_VERSION} MCP server on http://${HOST}:${PORT}/mcp (CORS: ${origins})`);
});

// Container platforms (Cloud Run, Kubernetes, ECS) send SIGTERM before stopping an
// instance. Stop accepting connections, let in-flight requests finish, then exit;
// give up after 10s so a stuck upstream call can't block the shutdown.
function shutdown(signal: string): void {
  console.error(`${signal} received, shutting down`);
  httpServer.close(() => process.exit(0));
  httpServer.closeIdleConnections();
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
