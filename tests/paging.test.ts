import { describe, it, expect } from "vitest";
import { pageSection, pageSections, DEFAULT_SECTION_CHARS } from "../src/lib/paging.js";

const sentence = (i: number) => `Sentence ${i} of a long dosing section.`;
const LONG = Array.from({ length: 400 }, (_, i) => sentence(i + 1)).join(" "); // ~15,000 chars
const sec = (content: string) => ({ code: "4.2", title: "Posology", content });

describe("pageSection", () => {
  it("leaves a short section untouched", () => {
    const s = sec("10 mg once daily.");
    expect(pageSection(s)).toEqual(s);
  });

  it("cuts a long section on a sentence boundary and says where to resume", () => {
    const p = pageSection(sec(LONG));
    expect(p.truncated).toBe(true);
    expect(p.total_chars).toBe(LONG.length);
    expect(p.content.endsWith(" …")).toBe(true);
    expect(p.content.length).toBeLessThanOrEqual(DEFAULT_SECTION_CHARS + 2);
    expect(p.content.replace(/ …$/, "").endsWith(".")).toBe(true);
    expect(p.offset).toBeUndefined();
    expect(LONG.startsWith(p.content.replace(/ …$/, ""))).toBe(true);
  });

  it("reassembles the full verbatim section from consecutive pages", () => {
    let offset = 0;
    const parts: string[] = [];
    for (let guard = 0; guard < 20; guard++) {
      const p = pageSection(sec(LONG), offset, 2000);
      parts.push(p.content.replace(/ …$/, ""));
      if (!p.truncated) break;
      expect(p.next_offset).toBeGreaterThan(offset);
      offset = p.next_offset!;
    }
    expect(parts.join(" ")).toBe(LONG);
  });

  it("marks the final page with offset and total but not truncated", () => {
    const first = pageSection(sec(LONG), 0, 2000);
    let p = first;
    while (p.truncated) p = pageSection(sec(LONG), p.next_offset!, 2000);
    expect(p.truncated).toBeUndefined();
    expect(p.offset).toBeGreaterThan(0);
    expect(p.total_chars).toBe(LONG.length);
    expect(LONG.endsWith(p.content)).toBe(true);
  });

  it("returns an empty page past the end", () => {
    const p = pageSection(sec("Short."), 100);
    expect(p.content).toBe("");
    expect(p.total_chars).toBe(6);
    expect(p.truncated).toBe(false);
  });

  it("falls back to a hard cut when there is no boundary to cut on", () => {
    const blob = "x".repeat(5000);
    const p = pageSection(sec(blob), 0, 1000);
    expect(p.content).toBe("x".repeat(1000) + " …");
    expect(p.next_offset).toBe(1000);
  });

  it("keeps a flag set upstream on a short pre-cut section", () => {
    const pre = { ...sec("First part of a section cut upstream. …"), truncated: true };
    expect(pageSection(pre).truncated).toBe(true);
  });
});

describe("pageSections", () => {
  it("pages every section independently", () => {
    const out = pageSections([sec("Short."), sec(LONG)], 0, 3000);
    expect(out[0].truncated).toBeUndefined();
    expect(out[1].truncated).toBe(true);
  });
});

import { registerSmpcTool } from "../src/tools/smpc.js";
import { registerUspiTool } from "../src/tools/uspi.js";
import { registerCompareLabelsTool } from "../src/tools/compare-labels.js";

describe("paging parameters accept numeric strings", () => {
  it("coerces \"12000\" and \"5988\" on all three label tools", () => {
    const schemas: Record<string, any> = {};
    const fake = { tool: (name: string, _d: string, schema: any) => { schemas[name] = schema; } } as any;
    registerSmpcTool(fake);
    registerUspiTool(fake);
    registerCompareLabelsTool(fake);
    for (const name of ["get_smpc", "get_uspi", "compare_labels"]) {
      expect(schemas[name].max_chars.parse("12000")).toBe(12000);
      expect(schemas[name].max_chars.safeParse("abc").success).toBe(false);
      expect(schemas[name].max_chars.safeParse("100").success).toBe(false); // below minimum
    }
    expect(schemas.get_smpc.offset.parse("5988")).toBe(5988);
    expect(schemas.get_uspi.offset.parse(5988)).toBe(5988);
  });
});
