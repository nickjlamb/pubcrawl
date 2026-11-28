import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { nothingFound } from "../src/lib/outcome.js";
import { instrumentTools, type ToolCallInfo } from "../src/server.js";

/** A bare server with three stand-in tools, so no PubCrawl tool (and no network) is involved. */
async function connect(onToolCall: (info: ToolCallInfo) => void) {
  const server = new McpServer({ name: "instrument-test", version: "0.0.0" });
  instrumentTools(server, onToolCall);
  server.tool("echo", "Echo text", { text: z.string() }, async ({ text }) => ({
    content: [{ type: "text", text }],
  }));
  server.tool("fails", "Returns an error result", {}, async () => ({
    content: [{ type: "text", text: "upstream said no" }],
    isError: true,
  }));
  server.tool("empty", "Looks and finds nothing", {}, async () =>
    nothingFound({ content: [{ type: "text" as const, text: "No PMC full text available" }], isError: true }),
  );
  server.tool("throws", "Throws", {}, async () => {
    throw new Error("boom");
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "instrument-test-client", version: "0.0.0" });
  await server.connect(serverSide);
  await client.connect(clientSide);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

describe("instrumentTools", () => {
  it("reports name, outcome and duration for each call, and nothing else", async () => {
    const calls: ToolCallInfo[] = [];
    const { client, close } = await connect((info) => calls.push(info));
    try {
      const echoed = await client.callTool({ name: "echo", arguments: { text: "secret query" } });
      expect(echoed.content).toEqual([{ type: "text", text: "secret query" }]);
      expect((await client.callTool({ name: "fails", arguments: {} })).isError).toBe(true);
      expect((await client.callTool({ name: "throws", arguments: {} })).isError).toBe(true);
    } finally {
      await close();
    }
    expect(calls.map((c) => [c.tool, c.ok])).toEqual([
      ["echo", true],
      ["fails", false],
      ["throws", false],
    ]);
    for (const call of calls) {
      expect(Object.keys(call).sort()).toEqual(["durationMs", "nothingFound", "ok", "tool"]);
      expect(call.durationMs).toBeGreaterThanOrEqual(0);
    }
    expect(JSON.stringify(calls)).not.toContain("secret query");
  });

  it("does not count calls that never reach a handler", async () => {
    const calls: ToolCallInfo[] = [];
    const { client, close } = await connect((info) => calls.push(info));
    try {
      await client.callTool({ name: "no_such_tool", arguments: {} }).catch(() => undefined);
      await client.callTool({ name: "echo", arguments: { text: 42 } }).catch(() => undefined);
    } finally {
      await close();
    }
    expect(calls).toEqual([]);
  });

  it("a failing hook does not change the tool's result", async () => {
    const { client, close } = await connect(() => {
      throw new Error("logging is down");
    });
    try {
      const result = await client.callTool({ name: "echo", arguments: { text: "hi" } });
      expect(result.isError).toBeFalsy();
      expect(result.content).toEqual([{ type: "text", text: "hi" }]);
    } finally {
      await close();
    }
  });
});

describe("instrumentTools outcomes", () => {
  it("reports 'nothing found' without changing what the client receives", async () => {
    const calls: ToolCallInfo[] = [];
    const { client, close } = await connect((info) => calls.push(info));
    try {
      const empty = await client.callTool({ name: "empty", arguments: {} });
      expect(empty.isError).toBe(true);
      expect(empty.content).toEqual([{ type: "text", text: "No PMC full text available" }]);
      expect(Object.keys(empty).sort()).toEqual(["content", "isError"]);
      await client.callTool({ name: "fails", arguments: {} });
      await client.callTool({ name: "echo", arguments: { text: "x" } });
    } finally {
      await close();
    }
    expect(calls.map((c) => [c.tool, c.ok, c.nothingFound])).toEqual([
      ["empty", false, true],
      ["fails", false, false],
      ["echo", true, false],
    ]);
  });
});

