#!/usr/bin/env node
/**
 * Draw the control papers for the check_references benchmark.
 *
 * Implements "Set 1: control papers / Sampling" in benchmark/REFERENCES-PROTOCOL.md
 * and nothing else: it picks papers, it does not check a single reference.
 *
 *   - Seeded generator (mulberry32), so the same seed always gives the same draws.
 *   - Draw PMCIDs uniformly from PMC4000000 to PMC9000000, without repeats.
 *   - Keep a paper if it was published 2015 to 2021, is a research or review
 *     article, and its PMC XML has a reference list of at least 10 references.
 *   - Stop at 100 kept. The first 30 are the development set, the next 70 held out.
 *   - Every draw is written to the output with what was found and why it was
 *     kept or skipped.
 *
 * Order matters for pre-registration: commit this script first, then run it and
 * commit its output. The script refuses to overwrite an existing output file.
 *
 * Usage (after `npm run build`):
 *   node benchmark/references/sample.mjs                 # the registered sample
 *   node benchmark/references/sample.mjs --seed 1 --target 5 --out /tmp/try.json
 *                                                        # a trial run that leaves the registered sample alone
 */
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";
import { efetch } from "../../dist/lib/ncbi.js";
import { parseXml, findAllElements, extractText } from "../../dist/lib/xml-parser.js";
import { parseJatsReferences } from "../../dist/lib/references.js";

export const REGISTERED = {
  seed: 20261124,
  pmcid_min: 4000000,
  pmcid_max: 9000000,
  year_min: 2015,
  year_max: 2021,
  article_types: ["research-article", "review-article"],
  min_references: 10,
  target: 100,
  development: 30,
};

/** Hard stop so a mistake in the criteria cannot loop for ever. */
const MAX_DRAWS = 20000;

/** mulberry32: a small, well-known 32-bit generator. Returns numbers in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An integer from min to max inclusive. */
export function drawInt(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

/**
 * The earliest publication year in a JATS article (print or electronic), or null.
 * The date PMC released the record is not a publication date and is ignored.
 */
export function publicationYear(article) {
  const meta = article?.front?.["article-meta"];
  const years = [];
  for (const date of findAllElements(meta ?? {}, "pub-date")) {
    if (typeof date !== "object" || date === null) continue;
    const kind = String(date["@_pub-type"] ?? date["@_date-type"] ?? "").toLowerCase();
    if (kind === "pmc-release") continue;
    const year = Number(String(extractText(date.year)).match(/\d{4}/)?.[0]);
    if (Number.isInteger(year)) years.push(year);
  }
  return years.length > 0 ? Math.min(...years) : null;
}

/** Decide one fetched record. Pure: takes parsed XML, returns what was found and the verdict. */
export function assess(parsed, criteria) {
  const found = parsed?.["pmc-articleset"]?.article ?? parsed?.article;
  const article = Array.isArray(found) ? found[0] : found;
  if (!article || typeof article !== "object") return { kept: false, reason: "no_such_record" };

  const type = String(article["@_article-type"] ?? "");
  const year = publicationYear(article);
  const references = parseJatsReferences(article.back).length;
  const facts = { article_type: type, year, references };

  if (year === null) return { ...facts, kept: false, reason: "no_publication_year" };
  if (year < criteria.year_min || year > criteria.year_max) return { ...facts, kept: false, reason: "year_out_of_range" };
  if (!criteria.article_types.includes(type)) return { ...facts, kept: false, reason: "article_type" };
  if (references < criteria.min_references) {
    return { ...facts, kept: false, reason: references === 0 ? "no_reference_list" : "too_few_references" };
  }
  return { ...facts, kept: true, reason: "kept" };
}

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

function gitCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: dirname(fileURLToPath(import.meta.url)), encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const criteria = {
    ...REGISTERED,
    seed: Number(option("seed", REGISTERED.seed)),
    target: Number(option("target", REGISTERED.target)),
  };
  criteria.development = Math.min(REGISTERED.development, criteria.target);
  const out = option("out", join(here, "..", "cases", "references-control-sample.json"));
  const registered = criteria.seed === REGISTERED.seed && criteria.target === REGISTERED.target;

  if (existsSync(out)) {
    console.error(`${out} already exists. The sample is drawn once; delete the file yourself if you really mean to redraw.`);
    process.exit(1);
  }

  const random = mulberry32(criteria.seed);
  const seen = new Set();
  const draws = [];
  const kept = [];

  while (kept.length < criteria.target && draws.length < MAX_DRAWS) {
    const id = drawInt(random, criteria.pmcid_min, criteria.pmcid_max);
    if (seen.has(id)) continue; // a repeat is not a new draw
    seen.add(id);
    const pmcid = `PMC${id}`;
    let verdict;
    try {
      verdict = assess(parseXml(await efetch({ db: "pmc", id: String(id), rettype: "xml" })), criteria);
    } catch (error) {
      // A paper that could not be fetched is skipped and logged, never retried into the sample later.
      verdict = { kept: false, reason: "fetch_failed", error: error instanceof Error ? error.message : String(error) };
    }
    draws.push({ draw: draws.length + 1, pmcid, ...verdict });
    if (verdict.kept) kept.push(pmcid);
    if (draws.length % 25 === 0) console.error(`${draws.length} draws, ${kept.length} kept`);
  }

  const skipped = {};
  for (const d of draws) if (!d.kept) skipped[d.reason] = (skipped[d.reason] ?? 0) + 1;

  const result = {
    protocol: "benchmark/REFERENCES-PROTOCOL.md",
    registered_sample: registered,
    drawn_on: new Date().toISOString(),
    commit: gitCommit(),
    criteria,
    complete: kept.length === criteria.target,
    draws_made: draws.length,
    skipped_by_reason: skipped,
    development: kept.slice(0, criteria.development),
    held_out: kept.slice(criteria.development),
    draws,
  };
  writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
  console.error(
    `${kept.length} kept from ${draws.length} draws${result.complete ? "" : " (INCOMPLETE: draw limit reached)"}. Wrote ${out}`,
  );
  if (!result.complete) process.exit(1);
}

// Run only when called directly, so the helpers above can be imported and tested.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
