import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildToolSpec, compactSchema, serializeToolSpec, TOOLSPEC_MAX_BYTES } from "../src/toolspec.js";

describe("compactSchema", () => {
  it("drops $schema and string descriptions but keeps structure", () => {
    const schema = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms" },
        max: { type: "number", minimum: 1, maximum: 100, default: 10, description: "Limit" },
        sort: { type: "string", enum: ["relevance", "date"] },
      },
      required: ["query"],
      additionalProperties: false,
    };
    expect(compactSchema(schema)).toEqual({
      type: "object",
      properties: {
        query: { type: "string" },
        max: { type: "number", minimum: 1, maximum: 100, default: 10 },
        sort: { type: "string", enum: ["relevance", "date"] },
      },
      required: ["query"],
      additionalProperties: false,
    });
  });

  it("keeps a property that is itself named description", () => {
    const schema = { type: "object", properties: { description: { type: "string", description: "x" } } };
    expect(compactSchema(schema)).toEqual({ type: "object", properties: { description: { type: "string" } } });
  });
});

describe("Agent Registry tool spec", () => {
  it("lists all 14 tools with name, description, annotations and input schema", async () => {
    const { tools } = await buildToolSpec();
    expect(tools).toHaveLength(14);
    for (const tool of tools) {
      expect(Object.keys(tool).sort()).toEqual(["annotations", "description", "inputSchema", "name"]);
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(tool.inputSchema).toMatchObject({ type: "object" });
    }
  });

  it("keeps each tool's required parameters", async () => {
    const { tools } = await buildToolSpec();
    const search = tools.find((t) => t.name === "search_pubmed");
    expect(search?.inputSchema).toMatchObject({ required: ["query"] });
  });

  it("stays under Agent Registry's 10 KB limit", async () => {
    const bytes = Buffer.byteLength(serializeToolSpec(await buildToolSpec()));
    expect(bytes).toBeLessThanOrEqual(TOOLSPEC_MAX_BYTES);
  });

  it("matches the committed deploy/agent-registry/toolspec.json", async () => {
    const committed = readFileSync(new URL("../deploy/agent-registry/toolspec.json", import.meta.url), "utf8");
    expect(committed).toBe(serializeToolSpec(await buildToolSpec()));
  });
});
