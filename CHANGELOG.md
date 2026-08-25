# Changelog

All notable changes to PubCrawl are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/nickjlamb/pubcrawl/compare/v2.5.0...HEAD
[2.5.0]: https://github.com/nickjlamb/pubcrawl/compare/v2.4.0...v2.5.0
[2.4.0]: https://github.com/nickjlamb/pubcrawl/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/nickjlamb/pubcrawl/compare/v2.1.1...v2.3.0
[2.1.1]: https://github.com/nickjlamb/pubcrawl/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/nickjlamb/pubcrawl/compare/v1.0.0...v2.1.0
[1.0.0]: https://github.com/nickjlamb/pubcrawl/releases/tag/v1.0.0
