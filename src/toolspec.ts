import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPubCrawlServer } from "./server.js";

/** Google Cloud Agent Registry rejects tool specs larger than this. */
export const TOOLSPEC_MAX_BYTES = 10 * 1024;

export interface ToolSpecEntry {
  name: string;
  description?: string;
  annotations?: Record<string, unknown>;
  inputSchema: Record<string, unknown>;
}

/**
 * Remove `$schema` and every string-valued `description` from a JSON Schema, keeping
 * its structure: types, properties, required, enums, defaults and ranges. A property
 * that happens to be named "description" is an object, not a string, so it is kept.
 */
export function compactSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(compactSchema);
  if (schema === null || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "$schema") continue;
    if (key === "description" && typeof value === "string") continue;
    out[key] = compactSchema(value);
  }
  return out;
}

/**
 * Build the tool spec Agent Registry needs for manual registration of a remote MCP
 * server, read from the real server over an in-memory MCP connection so it can't drift
 * from the code. Each tool keeps its name, description, annotations and input schema
 * (the registry requires the schema). Parameter-level descriptions are dropped from the
 * schemas to fit the registry's 10 KB limit; connected clients still get the complete
 * schemas, descriptions included, from the server's own tools/list.
 */
export async function buildToolSpec(): Promise<{ tools: ToolSpecEntry[] }> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createPubCrawlServer();
  const client = new Client({ name: "pubcrawl-toolspec", version: "0.0.0" });
  await server.connect(serverSide);
  await client.connect(clientSide);
  try {
    const { tools } = await client.listTools();
    return {
      tools: tools.map(({ name, description, annotations, inputSchema }) => ({
        name,
        ...(description !== undefined && { description }),
        ...(annotations !== undefined && { annotations: annotations as Record<string, unknown> }),
        inputSchema: compactSchema(inputSchema) as Record<string, unknown>,
      })),
    };
  } finally {
    await client.close();
    await server.close();
  }
}

/** Compact JSON: indentation alone would push the spec past the 10 KB limit. */
export function serializeToolSpec(spec: { tools: ToolSpecEntry[] }): string {
  return JSON.stringify(spec) + "\n";
}
