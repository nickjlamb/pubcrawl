import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpApp, parseAllowedOrigins } from "../src/http-app.js";
import { SERVER_VERSION } from "../src/server.js";

// These tests start the real HTTP server on an ephemeral local port. They exercise
// the transport and protocol handshake only; no tool is called, so nothing leaves the machine.

const EXPECTED_TOOLS = [
  "compare_labels",
  "find_related",
  "format_citation",
  "get_abstract",
  "get_full_text",
  "get_smpc",
  "get_trial",
  "get_uspi",
  "resolve_drug_name",
  "search_by_indication",
  "search_europepmc",
  "search_pubmed",
  "search_trials",
  "trending_papers",
];

async function start(allowedOrigins: "*" | string[]): Promise<{ server: Server; base: string }> {
  const server = createHttpApp({ allowedOrigins });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${port}` };
}

async function stop(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe("parseAllowedOrigins", () => {
  it("treats unset, blank and * as any origin", () => {
    expect(parseAllowedOrigins(undefined)).toBe("*");
    expect(parseAllowedOrigins("  ")).toBe("*");
    expect(parseAllowedOrigins("*")).toBe("*");
  });

  it("splits, trims and drops trailing slashes", () => {
    expect(parseAllowedOrigins(" https://a.example/, https://b.example ,")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });
});

describe("HTTP transport (any origin)", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    ({ server, base } = await start("*"));
  });
  afterAll(async () => stop(server));

  it("reports health with the package version", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", server: "pubcrawl", version: SERVER_VERSION });
  });

  it("returns 404 for unknown paths", async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
  });

  it("rejects GET and DELETE on /mcp in stateless mode", async () => {
    for (const method of ["GET", "DELETE"]) {
      const res = await fetch(`${base}/mcp`, { method });
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST, OPTIONS");
    }
  });

  it("answers CORS preflight for any origin", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "OPTIONS",
      headers: { Origin: "https://anywhere.example" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("completes the MCP handshake and lists all 14 tools", async () => {
    const client = new Client({ name: "pubcrawl-test", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    try {
      expect(client.getServerVersion()).toMatchObject({ name: "pubcrawl", version: SERVER_VERSION });
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(EXPECTED_TOOLS);
    } finally {
      await client.close();
    }
  });

  it("handles concurrent sessions independently", async () => {
    const clients = await Promise.all(
      [1, 2, 3].map(async (i) => {
        const c = new Client({ name: `pubcrawl-test-${i}`, version: "0.0.0" });
        await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
        return c;
      }),
    );
    try {
      const counts = await Promise.all(clients.map(async (c) => (await c.listTools()).tools.length));
      expect(counts).toEqual([14, 14, 14]);
    } finally {
      await Promise.all(clients.map((c) => c.close()));
    }
  });
});

describe("HTTP transport (origin allowlist)", () => {
  let server: Server;
  let base: string;
  const allowed = "https://agents.internal.example";

  beforeAll(async () => {
    ({ server, base } = await start([allowed]));
  });
  afterAll(async () => stop(server));

  it("echoes an allowed origin", async () => {
    const res = await fetch(`${base}/health`, { headers: { Origin: allowed } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(allowed);
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("refuses a request from any other origin", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("still serves clients that send no Origin (server-to-server agents)", async () => {
    const client = new Client({ name: "pubcrawl-test", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    try {
      expect((await client.listTools()).tools).toHaveLength(14);
    } finally {
      await client.close();
    }
  });
});
