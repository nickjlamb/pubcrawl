# Changelog

All notable changes to PubCrawl are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.6.4] — 2026-10-06

### Security
- **OpenClaw plugin** (`openclaw-plugin/`): `fast-xml-parser` `^4.3.0` → `^5.11.2`, matching the main package. Its parsing setup is identical; on live PubMed and PMC XML the returned abstracts, authors, MeSH terms, sections and captions are byte-identical, and v5 now reads alphanumeric reference page numbers (e.g. `e01736`) that v4 dropped to `null`.
- Main package: `@modelcontextprotocol/sdk` minimum `^1.26.0` → `^1.32.1`, and dev `eslint` minimum `^9.0.0` → `^9.39.5`. `npm audit`: 0 vulnerabilities.

## [2.6.3] — 2026-10-06

### Security
- **Minimum dependency versions raised** so the declared ranges no longer admit known-vulnerable releases: `@modelcontextprotocol/sdk` `^1.0.0` → `^1.26.0` (DNS-rebinding advisory affects < 1.24.0) and `fast-xml-parser` `^4.3.0` → `^5.11.2`. The parser major clears the last open advisory (XMLBuilder comment/CDATA injection, which PubCrawl never used); `XMLParser` output was checked identical on live PubMed abstracts, full text, citations, related articles and date-sorted searches.
- Lockfile refresh via `npm audit fix` (includes a `proxy-addr` fix). `npm audit` now reports **0 vulnerabilities**.

### Changed
- Test tooling: `vitest` and `@vitest/coverage-v8` 2.x → 4.x, clearing the dev-only `vitest`/`vite`/`esbuild` advisories. Still supports Node 20 (CI unchanged).

## [2.6.2] — 2026-09-28

### Security
- Dependency refresh via `npm audit fix` (lockfile only, no range changes): clears all production-dependency advisories, including the critical and high `fast-xml-parser` DOCTYPE entity-expansion issues (4.5.3 → 4.5.7) and high-severity advisories in transitive dependencies of the MCP SDK and cheerio (`hono`, `@hono/node-server`, `undici`, `path-to-regexp`, `express-rate-limit`, `ip-address`, `fast-uri`, `qs`, `ajv`, `body-parser`). The one remaining `fast-xml-parser` advisory affects `XMLBuilder`, which PubCrawl does not use. The remaining advisories are in dev-only test tooling (`vitest` 2.x / `vite` / `esbuild`) and need a major `vitest` upgrade.

### Changed
- `server.json` version synced with the npm package so the MCP Registry lists the current release.

## [2.6.1] — 2026-09-26

### Fixed
- `zod` is now a declared dependency. Every tool imports it, but it was previously only installed as the MCP SDK's peer dependency, so strict installers (e.g. pnpm) failed to build PubCrawl.

## [2.6.0] — 2026-09-14

### Added
- **Fidelity benchmark** (`benchmark/`) — deterministic, judge-free checks for the two tool families the OpenGATE literature gate doesn't cover. `compare_labels` is measured against a gold set of hand-verified US/UK anchors (phrases that must appear on one side and must not on the other, so a real divergence is surfaced rather than smoothed over), a section-coverage metric, and a verbatim check that refetches the raw openFDA record and eMC page independently and confirms every returned sentence is a substring of the source. `get_trial` is checked against registry anchors (title, phase, sponsor, conditions, interventions, primary outcome, linked PMIDs). Cases are `draft` until a person verifies them live; only `verified` cases can fail the gate. `npm run bench`.
- The benchmark's first runs also documented three limits in the shared `@pharmatools/drug-data` engine, now on the roadmap: every section is cut at 1,400 characters (13 of 40 sections returned in run 3); openFDA best-match takes the five most recently updated labels, so common generics (ibuprofen, omeprazole) land on OTC labels with no contraindications section, and others on generic manufacturers' labels that may carve out indications; and the eMC side fails intermittently under sequential load with no way to tell throttling from absence. The runner now paces requests and retries an unavailable side once, reporting recovered sides as transient.
- **`labelling-trials-gate`** job in the OpenGATE workflow — runs the benchmark in `--ci` mode on release and weekly, uploading results as an artifact.
- Unit tests for the labelling side (`tests/label-mapping.test.ts`, `tests/compare-labels.test.ts`, `tests/search-indication.test.ts`) — 26 new cases; the suite is now 88 tests.

- **`compare_labels` per-side names.** Optional `us_drug` / `uk_drug` override the lookup name on one side, for products whose brand differs by market (Farxiga/Forxiga, Prilosec/Losec) or where a generic resolves badly on one side; the result records `lookup_names` when used. Surfaced by the benchmark: a single string could not pin the reference product in both markets.

### Changed
- **`compare_labels` never leaves a missing side unexplained.** The result now carries `us_label` / `uk_label` (`status: ok | unavailable`, product name as the source lists it, sections returned, and a note saying what `unavailable` can and cannot mean), and each comparison whose `us_section` / `uk_section` is null gets a `us_note` / `uk_note` distinguishing "label retrieved but has no such section" from "label unavailable". Previously all three of "not licensed in this market", "source unreachable" and "section absent" looked like the same bare `null`.
- **Truncated sections are flagged.** The shared engine caps every label section at 1,400 characters and appends "…" (surfaced by the new benchmark: Keytruda's TMB-H indication, tamoxifen's DCIS and atorvastatin's UK 4.4 myopathy text all sit past the cut). `compare_labels`, `get_uspi` and `get_smpc` now set `truncated: true` on such sections, and `compare_labels` adds a note that absence of a phrase from a cut section proves nothing, with the source URL to read the rest. Raising or exposing the cap is a `@pharmatools/drug-data` change (roadmap).
- When neither label can be retrieved the error now says so plainly and points to `resolve_drug_name`, instead of the misleading "No labelling found" that also fired on network failures.
- Label fetchers are injectable into `buildCompareResult`, so the pairing logic is tested offline with fixture labels.
- `mergeIndicationResults` extracted from `search_by_indication` as a pure, tested function, with the UK-approval rule (at least one eMC product for the generic name) stated explicitly rather than implied by the batching code.

### Fixed
- **Topic filter over-matched.** Asking `compare_labels` for `["indications"]` also returned Contraindications, because topic matching was a bare substring test. Matching is now whole-topic, prefix, single-word or word-bounded phrase — `indications` selects Indications only; `contraindications`, `interactions`, `special warnings and precautions for use` all resolve to exactly one topic. Caught by the new tests.

### Removed
- `src/lib/dailymed.ts` — dead since 2.2.0, when labelling moved to the shared `@pharmatools/drug-data` engine.

## [2.5.1] — 2026-08-25

### Added
- Demo animation in the README showing a live `compare_labels` call for semaglutide.

## [2.5.1] — 2026-08-25

### Changed
- README now leads with `compare_labels`, the one tool no other MCP server offers, using a worked semaglutide example: the cardiovascular indication is on-label in the US and unlicensed in the UK.
- Architecture diagram replaced with hand-crafted light/dark SVGs served via `<picture>`, regenerable from `docs/gen_diagram.py`.

### Added
- `CITATION.cff` — PubCrawl is now citable in published work, with a Zenodo DOI minted on release.

## [2.5.0] — 2026-07-30

### Changed
- `search_europepmc` now returns `authors` as a `string[]` (was a single joined string), matching `search_pubmed`'s shape so downstream consumers can treat author lists uniformly. Surfaced by wiring the tool into OpenGATE's retrieval fidelity checks.

### Added
- OpenGATE retrieval-fidelity gate (`.github/workflows/opengate.yml`) — runs on release, checking that records come back matching hand-verified anchors across PubMed and Europe PMC, so a parser change can't silently corrupt the evidence downstream tools ground on.

## [2.4.0] — 2026-07-30

### Added
- **`search_europepmc`** — search Europe PMC alongside PubMed. Covers preprints (bioRxiv, medRxiv) and patents, and returns an abstract snippet, citation count, open-access status, and a preprint flag per result. Supports `preprintsOnly`, `openAccessOnly`, and `relevance`/`date`/`cited` sorting.
- **Test suite** — Vitest unit tests (fixture-based, no network) covering the XML/JATS/SPL parsers, LRU cache, summary formatter, citation formatters, Europe PMC mapper, and ClinicalTrials.gov mapper.
- **ESLint** — flat-config `typescript-eslint` setup.
- CI now runs **lint → test → build** on every push and pull request (previously build only).
- Project docs: README overhaul with banner and architecture diagram, `CONTRIBUTING.md`, `ROADMAP.md`, this changelog, `SECURITY.md`, and GitHub issue/PR templates.

### Fixed
- `search_pubmed`, `find_related`, and `trending_papers` populated an `abstract_snippet` field from `sorttitle` — a normalised copy of the **title**, not an abstract (NCBI's esummary returns no abstract text). The misleading field has been removed; use `get_abstract` for real abstract text. The shared formatting logic is now a single tested helper.

## [2.3.0] — 2026-06-15

### Added
- **`resolve_drug_name`** — convert between brand and generic drug names (with drug class and common indications) deterministically via RxNorm/openFDA.

## 2.2.0 — 2026-06-15

### Added
- **Streamable HTTP transport** (`src/http.ts`) for hosted and browser-based MCP clients, with a `/health` endpoint and CORS headers.
- CI build/type-check workflow, README badges, and a sponsor (`FUNDING`) button.

### Changed
- Drug labelling tools now run on the shared `@pharmatools/drug-data` engine.

## [2.1.1] — 2026-02-16

### Changed
- Documentation updates for the ClinicalTrials.gov tools.

## [2.1.0] — 2026-02-16

### Added
- **ClinicalTrials.gov integration** — `search_trials` and `get_trial` (eligibility, design, arms, outcomes, associated PMIDs).
- Published to npm (`@pharmatools/pubcrawl`) and the MCP Registry.

## 2.0.0 — 2026-02-16

### Added
- **US & UK drug labelling** — `get_uspi` (openFDA/DailyMed), `get_smpc` (UK eMC), `compare_labels` (side-by-side US vs UK), and `search_by_indication`.

## [1.0.0] — 2026-02-15

### Added
- Initial release: PubMed literature tools — `search_pubmed`, `get_abstract`, `get_full_text`, `find_related`, `format_citation`, and `trending_papers`.

[Unreleased]: https://github.com/nickjlamb/pubcrawl/compare/v2.6.0...HEAD
[2.6.0]: https://github.com/nickjlamb/pubcrawl/compare/v2.5.1...v2.6.0
[2.5.1]: https://github.com/nickjlamb/pubcrawl/compare/v2.5.0...v2.5.1
[2.5.0]: https://github.com/nickjlamb/pubcrawl/compare/v2.4.0...v2.5.0
[2.4.0]: https://github.com/nickjlamb/pubcrawl/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/nickjlamb/pubcrawl/compare/v2.1.1...v2.3.0
[2.1.1]: https://github.com/nickjlamb/pubcrawl/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/nickjlamb/pubcrawl/compare/v1.0.0...v2.1.0
[1.0.0]: https://github.com/nickjlamb/pubcrawl/releases/tag/v1.0.0
