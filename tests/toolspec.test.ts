import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildToolSpec, serializeToolSpec, TOOLSPEC_MAX_BYTES } from "../src/toolspec.js";

describe("Agent Registry tool spec", () => {
  it("lists all 14 tools with name, description and annotations only", async () => {
    const { tools } = await buildToolSpec();
    expect(tools).toHaveLength(14);
    for (const tool of tools) {
      expect(Object.keys(tool).sort()).toEqual(["annotations", "description", "name"]);
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
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
