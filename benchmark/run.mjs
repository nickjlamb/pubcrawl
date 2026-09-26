#!/usr/bin/env node
/**
 * PubCrawl labelling & trials fidelity benchmark.
 *
 * Deterministic, no LLM judge. Runs the *built* server's own functions
 * (dist/) against the live sources and checks three things:
 *
 *   1. Coverage    — did compare_labels retrieve both sides, and the mapped section?
 *   2. Anchors     — hand-verified phrases that must appear on one side, and must
 *                    NOT appear on the other (the divergence is real, and surfaced).
 *   3. Verbatim    — is every sentence the tool returned a substring of the raw
 *                    source (openFDA JSON / eMC HTML) fetched independently?
 *                    This is the "0 invented" check: the parser adds nothing.
 *
 * Cases carry a status: "draft" (anchor written but not yet checked against the
 * live label by a human) or "verified". In --ci mode only verified cases can
 * fail the run; draft results are reported as warnings. Freeze the set by
 * verifying anchors, not by editing them to pass.
 *
 * Usage:
 *   npm run build && node benchmark/run.mjs            # labels + trials
 *   node benchmark/run.mjs --labels                    # one suite
 *   node benchmark/run.mjs --only ozempic-indications  # one case id (or drug)
 *   node benchmark/run.mjs --ci                        # exit 1 on verified failure
 *   node benchmark/run.mjs --save                      # write results/<date>.json
 *   node benchmark/run.mjs --no-verbatim               # skip the raw-source refetch
 *   node benchmark/run.mjs --dump                      # also write results/dump-<date>.json with the
 *                                                      # returned section text for every non-passing case
 *
 * Truncation: the shared drug-data engine caps each section at 1,400 characters
 * and appends "…". A must_contain anchor missing from a truncated section is
 * reported as UNVERIFIABLE (the phrase may sit past the cut), not as a miss; it
 * still fails the case, because the tool could not show the reader the text.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const argValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const only = argValue("--only");
const runLabels = args.has("--labels") || !args.has("--trials");
const runTrials = args.has("--trials") || !args.has("--labels");
const ci = args.has("--ci");
const save = args.has("--save");
const verbatim = !args.has("--no-verbatim");
const dump = args.has("--dump");

// --- helpers -----------------------------------------------------------------

/** Normalise text so anchors survive whitespace, case, quote and dash variants. */
export function norm(s) {
  return (s ?? "")
    .normalize("NFKC")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\u00a0/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const contains = (hay, needle) => norm(hay).includes(norm(needle));

/** Split returned section content into checkable sentences (>= minLen chars). */
export function sentences(content, minLen = 40, max = 30) {
  const parts = (content ?? "")
    .split(/(?<=[.;:])\s+|\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= minLen);
  if (parts.length <= max) return parts;
  // sample evenly so long sections don't dominate the check
  const step = parts.length / max;
  return Array.from({ length: max }, (_, i) => parts[Math.floor(i * step)]);
}

const UA = "PubCrawl-benchmark/1.0 (pharmatools.ai)";
const PACE_MS = 1500;   // pause between drugs
const RETRY_MS = 4000;  // pause before the single retry of an unavailable side

async function fetchText(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

/** Raw US label text from openFDA, fetched independently of the engine, by set id. */
async function rawUsText(dailymedUrl) {
  const setid = /setid=([0-9a-f-]+)/i.exec(dailymedUrl ?? "")?.[1];
  if (!setid) return null;
  const url = `https://api.fda.gov/drug/label.json?search=openfda.spl_set_id:%22${setid}%22&limit=1`;
  const json = JSON.parse(await fetchText(url));
  const r = json.results?.[0];
  if (!r) return null;
  const chunks = [];
  for (const [k, v] of Object.entries(r)) {
    if (k === "openfda") continue;
    if (Array.isArray(v)) chunks.push(...v.filter((x) => typeof x === "string"));
    else if (typeof v === "string") chunks.push(v);
  }
  return norm(chunks.join(" "));
}

/** Raw UK SmPC text from the eMC page, tags stripped, fetched independently. */
async function rawUkText(emcUrl) {
  if (!emcUrl) return null;
  const html = await fetchText(emcUrl);
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
  return norm(text);
}

const squash = (s) => norm(s).replace(/\s+/g, "");

/**
 * Whitespace-insensitive containment: the eMC page splits words across inline
 * tags and the engine re-flows whitespace, neither of which is invention.
 * Anything else — a changed, added or dropped word — still fails.
 */
function verbatimCheck(section, rawText) {
  if (!section || !rawText) return { checked: 0, matched: 0, misses: [] };
  const raw = squash(rawText);
  const ss = sentences(section.content).filter((x) => !/…\s*$/.test(x)); // the cut fragment is the engine's, not the source's
  const misses = ss.filter((x) => !raw.includes(squash(x)));
  return { checked: ss.length, matched: ss.length - misses.length, misses: misses.slice(0, 3) };
}

// --- labels suite ------------------------------------------------------------

async function runLabelSuite() {
  const { buildCompareResult } = await import(join(here, "..", "dist", "tools", "compare-labels.js"));
  const { cache } = await import(join(here, "..", "dist", "lib", "cache.js"));
  const file = JSON.parse(readFileSync(join(here, "cases", "labels.json"), "utf8"));
  let cases = file.cases;
  if (only) cases = cases.filter((c) => c.id === only || c.drug.toLowerCase() === only.toLowerCase());

  // One compare_labels call per (drug, us_drug, uk_drug) triple, covering the
  // union of the topics its cases need.
  const keyOf = (c) => `${c.drug}|${c.us_drug ?? ""}|${c.uk_drug ?? ""}`;
  const byDrug = new Map();
  for (const c of cases) {
    const k = keyOf(c);
    if (!byDrug.has(k)) byDrug.set(k, { drug: c.drug, names: { us: c.us_drug, uk: c.uk_drug }, topics: new Set() });
    if (c.topic) byDrug.get(k).topics.add(c.topic);
  }

  const results = [];
  const rawCache = new Map();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const unavailable = (res, side) => !("error" in res) && res[`${side}_label`].status === "unavailable";
  let transient = 0;
  let first = true;

  for (const [key, { drug, names, topics }] of byDrug) {
    // Pace the sources: the engine has no rate limiting of its own, and the eMC
    // throttles rapid sequential requests into silent nulls.
    if (!first) await sleep(PACE_MS);
    first = false;
    const sections = topics.size ? [...topics] : undefined;
    const t0 = Date.now();
    let res = await buildCompareResult(drug, sections, undefined, names);
    // One retry for an unavailable side, after a pause and with the in-process
    // cache cleared: separates "transient" (recovered) from "absent" (still
    // unavailable). Both are recorded.
    const retrySides = ["us", "uk"].filter((side) => "error" in res || unavailable(res, side));
    let recovered = [];
    if (retrySides.length) {
      await sleep(RETRY_MS);
      cache.clear();
      const again = await buildCompareResult(drug, sections, undefined, names);
      recovered = retrySides.filter((side) => !("error" in again) && !unavailable(again, side));
      const avail = (r) => ["us", "uk"].filter((side) => !("error" in r) && !unavailable(r, side)).length;
      transient += recovered.length;
      // adopt the retry only if it is at least as complete as the first attempt
      if (avail(again) >= avail(res)) res = again;
    }
    const ms = Date.now() - t0;
    const drugCases = cases.filter((c) => keyOf(c) === key);

    for (const c of drugCases) {
      const r = { id: c.id, drug, topic: c.topic ?? null, status: c.status, pass: true, failures: [], ms };
      if (names.us || names.uk) r.lookup_names = { us: names.us ?? drug, uk: names.uk ?? drug };
      if (recovered.length) r.recovered_on_retry = recovered;

      // Expected-error / expected-status cases
      if (c.expect?.error) {
        r.pass = "error" in res;
        if (!r.pass) r.failures.push("expected an error result, got a comparison");
        results.push(r);
        continue;
      }
      if ("error" in res) {
        r.pass = false;
        r.failures.push(`tool error: ${res.error}`);
        results.push(r);
        continue;
      }
      if (c.expect?.us_status && res.us_label.status !== c.expect.us_status) {
        r.pass = false;
        r.failures.push(`us_label.status ${res.us_label.status}, expected ${c.expect.us_status}`);
      }
      if (c.expect?.uk_status && res.uk_label.status !== c.expect.uk_status) {
        r.pass = false;
        r.failures.push(`uk_label.status ${res.uk_label.status}, expected ${c.expect.uk_status}`);
      }
      if (c.expect && !c.topic) {
        results.push(r);
        continue;
      }

      const cmp = res.comparisons.find((x) => x.topic === c.topic);
      if (!cmp) {
        r.pass = false;
        r.failures.push(`no comparison for topic ${c.topic}`);
        results.push(r);
        continue;
      }
      r.coverage = { us: !!cmp.us_section, uk: !!cmp.uk_section };
      r.product = { us: res.us_label.product, uk: res.uk_label.product };

      for (const side of ["us", "uk"]) {
        const spec = c[side];
        if (!spec) continue;
        const section = cmp[`${side}_section`];
        const text = section?.content ?? "";
        const wantSide = spec.expect_status ?? "ok";
        if (wantSide === "ok" && !section) {
          r.pass = false;
          r.failures.push(`${side}: section missing — ${cmp[`${side}_note`] ?? "no note"}`);
          continue;
        }
        if (section?.truncated) {
          r.truncated = r.truncated ?? {};
          r.truncated[side] = true;
        }
        for (const a of spec.must_contain ?? []) {
          if (!contains(text, a)) {
            r.pass = false;
            if (section?.truncated) {
              r.unverifiable = (r.unverifiable ?? 0) + 1;
              r.failures.push(`${side}: UNVERIFIABLE — anchor "${a}" not in the returned text, but the section was cut at the engine's cap (${text.length} chars); may sit past the cut`);
            } else {
              r.failures.push(`${side}: missing anchor "${a}"`);
            }
          }
        }
        for (const a of spec.must_not_contain ?? []) {
          if (contains(text, a)) {
            r.pass = false;
            r.failures.push(`${side}: forbidden phrase present "${a}"`);
          }
        }
        if (verbatim && section) {
          const key = `${side}:${side === "us" ? res.us_source : res.uk_source}`;
          if (!rawCache.has(key)) {
            try {
              rawCache.set(key, side === "us" ? await rawUsText(res.us_source) : await rawUkText(res.uk_source));
            } catch (e) {
              rawCache.set(key, null);
              r.failures.push(`${side}: raw source refetch failed (${e.message}) — verbatim not checked`);
            }
          }
          const v = verbatimCheck(section, rawCache.get(key));
          r[`verbatim_${side}`] = v;
          if (v.checked && v.matched < v.checked) {
            r.pass = false;
            r.failures.push(`${side}: ${v.checked - v.matched}/${v.checked} sentences not found verbatim in source, e.g. "${v.misses[0]?.slice(0, 80)}"`);
          }
        }
      }
      if (dump && !r.pass) {
        r.dump = {
          us_label: res.us_label,
          uk_label: res.uk_label,
          us_source: res.us_source,
          uk_source: res.uk_source,
          us_section: cmp.us_section,
          uk_section: cmp.uk_section,
          us_note: cmp.us_note,
          uk_note: cmp.uk_note,
        };
      }
      results.push(r);
    }
  }
  return { file, results, transient };
}

// --- trials suite ------------------------------------------------------------

async function runTrialSuite() {
  const { getTrialDetail } = await import(join(here, "..", "dist", "lib", "clinicaltrials.js"));
  const file = JSON.parse(readFileSync(join(here, "cases", "trials.json"), "utf8"));
  let cases = file.cases;
  if (only) cases = cases.filter((c) => c.id === only || c.nct_id === only);
  const results = [];
  for (const c of cases) {
    const r = { id: c.id, nct_id: c.nct_id, status: c.status, pass: true, failures: [] };
    const t0 = Date.now();
    let d;
    try {
      d = await getTrialDetail(c.nct_id);
    } catch (e) {
      r.pass = false;
      r.failures.push(`fetch failed: ${e.message}`);
      results.push(r);
      continue;
    }
    r.ms = Date.now() - t0;
    if (d.nct_id !== c.nct_id) { r.pass = false; r.failures.push(`nct_id echoed as ${d.nct_id}`); }
    const check = (label, ok, detail) => { if (!ok) { r.pass = false; r.failures.push(`${label}: ${detail}`); } };
    if (c.title_contains) check("title", contains(d.title, c.title_contains) || contains(d.official_title, c.title_contains), `"${c.title_contains}" not in "${d.title}"`);
    if (c.phase_contains) check("phase", contains(d.phase, c.phase_contains), `"${c.phase_contains}" not in "${d.phase}"`);
    if (c.sponsor_contains) check("sponsor", contains(d.sponsor, c.sponsor_contains), `"${c.sponsor_contains}" not in "${d.sponsor}"`);
    if (c.conditions_any) check("conditions", c.conditions_any.some((x) => d.conditions.some((y) => contains(y, x))), `none of ${JSON.stringify(c.conditions_any)} in ${JSON.stringify(d.conditions)}`);
    if (c.interventions_any) check("interventions", c.interventions_any.some((x) => d.interventions.some((y) => contains(y.name, x))), `none of ${JSON.stringify(c.interventions_any)} in ${JSON.stringify(d.interventions.map((i) => i.name))}`);
    if (c.primary_outcome_contains) check("primary outcome", d.primary_outcomes.some((o) => contains(JSON.stringify(o), c.primary_outcome_contains)), `"${c.primary_outcome_contains}" not in primary outcomes`);
    if (c.min_enrollment != null) check("enrollment", (d.enrollment ?? 0) >= c.min_enrollment, `${d.enrollment} < ${c.min_enrollment}`);
    if (c.has_pmids) check("associated PMIDs", d.associated_pmids.length > 0, "none returned");
    results.push(r);
  }
  return { file, results };
}

// --- reporting ---------------------------------------------------------------

function summarise(name, results, extra = {}) {
  const verified = results.filter((r) => r.status === "verified");
  const draft = results.filter((r) => r.status !== "verified");
  const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : "n/a");
  const lines = [];
  lines.push(`\n${name}: ${results.length} cases — verified ${verified.filter((r) => r.pass).length}/${verified.length} pass, draft ${draft.filter((r) => r.pass).length}/${draft.length} pass`);
  for (const r of results) {
    const tag = r.pass ? "PASS" : r.status === "verified" ? "FAIL" : "warn";
    const prod = r.product ? `  us → ${r.product.us ?? "—"} | uk → ${r.product.uk ?? "—"}` : "";
    const rec = r.recovered_on_retry ? `  [${r.recovered_on_retry.join(",")} recovered on retry]` : "";
    lines.push(`  [${tag}] ${r.id}${r.ms ? ` (${r.ms} ms)` : ""}${prod}${rec}`);
    for (const f of r.failures) lines.push(`         - ${f}`);
  }
  const summary = { cases: results.length, verified: verified.length, verified_pass: verified.filter((r) => r.pass).length, draft: draft.length, draft_pass: draft.filter((r) => r.pass).length };
  if (name === "labels") {
    const cov = results.filter((r) => r.coverage);
    const both = cov.filter((r) => r.coverage.us && r.coverage.uk).length;
    let vc = 0, vm = 0;
    for (const r of results) for (const s of ["us", "uk"]) { const v = r[`verbatim_${s}`]; if (v) { vc += v.checked; vm += v.matched; } }
    const truncSides = results.reduce((n, r) => n + (r.truncated ? Object.keys(r.truncated).length : 0), 0);
    const unverifiable = results.reduce((n, r) => n + (r.unverifiable ?? 0), 0);
    summary.section_coverage = { both_sides: both, of: cov.length, pct: pct(both, cov.length) };
    summary.verbatim = { sentences_checked: vc, matched: vm, pct: pct(vm, vc) };
    summary.truncation = { sections_cut_by_engine: truncSides, anchors_unverifiable: unverifiable };
    const stillUnavailable = results.reduce((n, r) => n + (r.failures.filter((f) => /unavailable \(see/.test(f)).length), 0);
    summary.availability = { sides_recovered_on_retry: extra.transient ?? 0, sides_still_unavailable_after_retry: stillUnavailable };
    lines.push(`  availability: ${extra.transient ?? 0} sides recovered on a single retry (transient); ${stillUnavailable} still unavailable after retry`);
    lines.push(`  section coverage (both sides returned): ${both}/${cov.length} (${summary.section_coverage.pct})`);
    if (verbatim) lines.push(`  verbatim: ${vm}/${vc} returned sentences found in the raw source (${summary.verbatim.pct})`);
    lines.push(`  truncation: ${truncSides} returned sections cut at the engine's 1,400-char cap; ${unverifiable} anchors unverifiable because of it`);
  }
  console.log(lines.join("\n"));
  return summary;
}

const out = { ran_at: new Date().toISOString(), node: process.version, suites: {} };
let verifiedFailure = false;

if (runLabels) {
  const { file, results, transient } = await runLabelSuite();
  out.suites.labels = { set_version: file.version, frozen: file.frozen ?? false, summary: summarise("labels", results, { transient }), results };
  if (results.some((r) => r.status === "verified" && !r.pass)) verifiedFailure = true;
}
if (runTrials) {
  const { file, results } = await runTrialSuite();
  out.suites.trials = { set_version: file.version, frozen: file.frozen ?? false, summary: summarise("trials", results), results };
  if (results.some((r) => r.status === "verified" && !r.pass)) verifiedFailure = true;
}

if (dump) {
  mkdirSync(join(here, "results"), { recursive: true });
  const dumped = {};
  for (const [suite, v] of Object.entries(out.suites)) dumped[suite] = v.results.filter((r) => r.dump).map((r) => ({ id: r.id, failures: r.failures, ...r.dump }));
  const name = `dump-${out.ran_at.slice(0, 10)}.json`;
  writeFileSync(join(here, "results", name), JSON.stringify(dumped, null, 2));
  console.log(`Wrote benchmark/results/${name} (returned text for non-passing cases — for anchor verification, not for committing)`);
}
for (const v of Object.values(out.suites)) for (const r of v.results) delete r.dump;
if (save) {
  mkdirSync(join(here, "results"), { recursive: true });
  const name = `${out.ran_at.slice(0, 10)}.json`;
  writeFileSync(join(here, "results", name), JSON.stringify(out, null, 2));
  writeFileSync(join(here, "results", "latest.json"), JSON.stringify(out, null, 2));
  console.log(`\nSaved benchmark/results/${name} (and latest.json)`);
}

if (ci && verifiedFailure) {
  console.error("\nLabelling/trials fidelity gate FAILED: a verified case did not pass.");
  process.exit(1);
}
console.log(ci ? "\nFidelity gate passed." : "");
