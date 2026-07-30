# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PubCrawl is an MCP (Model Context Protocol) server that gives LLM clients (Claude Desktop, Cursor, etc.) access to PubMed, FDA/UK drug labelling, and ClinicalTrials.gov. Built by PharmaTools.AI.

## Commands

- `npm run build` — compile TypeScript (`src/`) to `dist/`
- `npm start` — run the compiled MCP server via stdio
- `npm run dev` — `tsc --watch` for development
- `npm test` — run the Vitest unit suite (`tests/`)
- `npm run test:watch` — Vitest in watch mode
- `npm run coverage` — Vitest with v8 coverage
- `npm run lint` — ESLint (flat config, `typescript-eslint`)

## Testing

Vitest unit tests live in `tests/` and cover the pure logic layers: the XML/JATS/SPL
parsers (`xml-parser.ts`), the LRU cache (`cache.ts`), the shared esummary→article
formatter (`pubmed-format.ts`), the Europe PMC result mapper (`europepmc.ts`),
the citation formatters (`cite.ts`), and the ClinicalTrials.gov summary mapper
(`clinicaltrials.ts`). Tests use fixture payloads —
no network calls. Functions that need testing are exported from their module; keep new
parsing/formatting logic as exported pure functions so it can be unit-tested the same way.
CI (`.github/workflows/build.yml`) runs lint → test → build on every push and PR.

## Architecture

The server has three layers:

**Tools** (`src/tools/`) — Each file exports a `register*Tool(server: McpServer)` function that registers one MCP tool with a zod schema and async handler. Handlers return `{ content: [{ type: "text", text: JSON.stringify(...) }] }` on success, adding `isError: true` on failure.

**NCBI Client** (`src/lib/ncbi.ts`) — Wraps the four E-utilities endpoints (`esearch`, `esummary`, `efetch`, `elink`) plus `pmidToPmcid`. All requests go through `rateLimitedFetch` (300ms delay without API key, 100ms with) with a 15s timeout. Every request includes `tool=pubcrawl` and `email=nick@pharmatools.ai`. Each function checks the cache before making a network call.

**XML Parser** (`src/lib/xml-parser.ts`) — Configures `fast-xml-parser` with `isArray` for elements that can appear once or multiple times in PubMed XML (Author, AbstractText, MeshHeading, Keyword, sec, fig, table-wrap, ref, etc.). This list is critical — if a new XML element needs consistent array handling, it must be added here. Provides two distinct author parsers: `parseAuthors` for efetch XML (`LastName`/`ForeName` elements) and `parseSummaryAuthors` for esummary JSON (`name` property).

**Europe PMC Client** (`src/lib/europepmc.ts`) — Wraps the Europe PMC REST API (`/search`, free, no auth). Covers a broader corpus than PubMed: journal articles (`source: MED`), preprints (`source: PPR`), full text in PMC (`source: PMC`), and patents. Rate-limited to one request per 200ms with cache. `searchEuropePmc` requests `resultType=core` (so each hit carries `abstractText`, `citedByCount`, `isOpenAccess`, `inEPMC`) and composes optional `AND (SRC:PPR)` / `AND (OPEN_ACCESS:Y)` filters into the query. The pure `formatEuropePmcResult` helper maps one `core` result to a `EuropePmcArticle` and is unit-tested against fixtures. `getEuropePmcFullText` fetches `/{source}/{id}/fullTextXML` (JATS — same shape as PMC) and delegates to the pure `parseEuropePmcFullText` helper, which reuses the JATS parsers from `xml-parser.ts`; a 404 is surfaced as a `NO_FULL_TEXT`-tagged error the tool turns into a friendly message.

**ClinicalTrials.gov Client** (`src/lib/clinicaltrials.ts`) — Wraps ClinicalTrials.gov API v2 (free, no auth). Rate-limited to 1.2s between requests (~50 req/min). `searchTrials` queries `/studies` with condition/intervention/term filters and field limiting. `getTrialDetail` fetches a single study by NCT ID with full parsing of eligibility, design, arms, outcomes, and associated PMIDs. Both functions use the shared `studyToSummary` helper to parse the nested API response.

**Cache** (`src/lib/cache.ts`) — Singleton LRU cache (500 entries). TTLs: search/related/summary = 1 hour, trial details = 4 hours, abstracts/fulltext/labels = 24 hours.

**Entry point** (`src/index.ts`) — Creates `McpServer`, loads optional `NCBI_API_KEY` from env, registers all tools, connects via `StdioServerTransport`. `src/http.ts` registers the same tool set behind a stateless Streamable HTTP transport; keep the two registration lists in sync when adding a tool.

## Tool → API Mapping

| Tool | Pipeline |
|------|----------|
| `search_pubmed` | esearch → esummary |
| `search_europepmc` | Europe PMC `/search` (`resultType=core`), map each result via `formatEuropePmcResult` |
| `get_europepmc_fulltext` | Europe PMC `/{source}/{id}/fullTextXML`, parse JATS via `parseEuropePmcFullText` |
| `get_abstract` | efetch rettype=xml, parse `AbstractText` with `@_Label` attributes |
| `get_full_text` | elink (PMID→PMCID) → efetch db=pmc rettype=xml, parse JATS `<sec>` elements |
| `find_related` | elink cmd=neighbor_score → esummary |
| `format_citation` | efetch rettype=xml, format as APA/Vancouver/Harvard/BibTeX |
| `trending_papers` | esearch (date-sorted) → esummary |
| `search_trials` | ClinicalTrials.gov `/studies` with condition/intervention/term/status/phase filters |
| `get_trial` | ClinicalTrials.gov `/studies/{nctId}`, parses eligibility, design, arms, outcomes, PMIDs |

## Key Conventions

- ESM modules throughout (`"type": "module"`). All local imports use `.js` extensions.
- TypeScript uses `module: "Node16"` / `moduleResolution: "Node16"`.
- Shared return-type interfaces live in `src/types.ts`.
- `esearch` and `esummary` use `retmode=json`; `efetch` returns XML.
