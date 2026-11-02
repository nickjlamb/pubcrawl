import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPubCrawlServer } from "./server.js";

/** Google Cloud Agent Registry rejects tool specs larger than this. */
export const TOOLSPEC_MAX_BYTES = 10 * 1024;

export interface ToolSpecEntry {
  name: string;
  description?: string;
  annotations?: Record<string, unknown>;
}

/**
 * Build the tool spec Agent Registry needs for manual registration of a remote MCP
 * server: each tool's name, description and annotations, read from the real server
 * over an in-memory MCP connection, so the spec can't drift from the code.
 * Input schemas are left out: the registry doesn't require them and they would
 * take the spec past the 10 KB limit. Clients still get them from tools/list.
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
      tools: tools.map(({ name, description, annotations }) => ({
        name,
        ...(description !== undefined && { description }),
        ...(annotations !== undefined && { annotations: annotations as Record<string, unknown> }),
      })),
    };
  } finally {
    await client.close();
    await server.close();
  }
}

export function serializeToolSpec(spec: { tools: ToolSpecEntry[] }): string {
  return JSON.stringify(spec, null, 2) + "\n";
}
