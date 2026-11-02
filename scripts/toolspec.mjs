#!/usr/bin/env node
// Regenerate deploy/agent-registry/toolspec.json from the built server.
// Usage: npm run build && npm run toolspec          (writes the file)
//        npm run build && npm run toolspec -- --check (fails if the file is stale)
import { readFileSync, writeFileSync } from "node:fs";
import { buildToolSpec, serializeToolSpec, TOOLSPEC_MAX_BYTES } from "../dist/toolspec.js";

const OUT = new URL("../deploy/agent-registry/toolspec.json", import.meta.url);
const text = serializeToolSpec(await buildToolSpec());
const bytes = Buffer.byteLength(text);

if (bytes > TOOLSPEC_MAX_BYTES) {
  console.error(`toolspec.json is ${bytes} bytes; Agent Registry's limit is ${TOOLSPEC_MAX_BYTES}.`);
  process.exit(1);
}

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {
    // missing file counts as stale
  }
  if (current !== text) {
    console.error("deploy/agent-registry/toolspec.json is out of date. Run: npm run build && npm run toolspec");
    process.exit(1);
  }
  console.log(`toolspec.json is up to date (${bytes} bytes).`);
} else {
  writeFileSync(OUT, text);
  console.log(`Wrote deploy/agent-registry/toolspec.json (${bytes} bytes).`);
}
