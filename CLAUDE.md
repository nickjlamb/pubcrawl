# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PubCrawl is an MCP (Model Context Protocol) server that gives LLM clients (Claude Desktop, Cursor, etc.) access to PubMed, FDA/UK drug labelling, and ClinicalTrials.gov. Built by PharmaTools.AI.

## Commands

- `npm run build` — compile TypeScript (`src/`) to `dist/`
- `npm start` — run the compiled MCP server via stdio
- `npm run start:http` — run it over Streamable HTTP (`PORT`, default 3000)
- `docker build -t pubcrawl . && docker run -p 8080:8080 pubcrawl` — container image
- `npm run dev` — `tsc --watch` for development
- `npm test` — run the Vitest unit suite (`tests/`)
- `npm run test:watch` — Vitest in watch mode
- `npm run coverage` — Vitest with v8 coverage
- `npm run lint` — ESLint (flat config, `typescript-eslint`)
- `npm run toolspec` — regenerate `deploy/agent-registry/toolspec.json` after `npm run build` (`-- --check` to verify)

## Testing

Vitest unit tests live in `tests/` and cover the pure logic layers: the XML/JATS/SPL
parsers (`xml-parser.ts`), the LRU cache (`cache.ts`), the shared esummary→article
formatter (`pubmed-format.ts`), the Europe PMC result mapper (`europepmc.ts`),
the citation formatters (`cite.ts`), and the ClinicalTrials.gov summary mapper
(`clinicaltrials.ts`), plus `http.test.ts`, which starts the real HTTP app on a local port
and checks the transport and handshake (it calls no tools). Tests use fixture payloads —
no network calls. Functions that need testing are exported from their module; keep new
parsing/formatting logic as exported pure functions so it can be unit-tested the same way.
CI (`.github/workflows/build.yml`) runs lint → test → build on every push and PR, plus a `container` job that builds and smoke-tests the Docker image.

## Architecture

The server has three layers:

**Tools** (`src/tools/`) — Each file exports a `register*Tool(server: McpServer)` function that registers one MCP tool with a zod schema and async handler. Handlers return `{ content: [{ type: "text", text: JSON.stringify(...) }] }` on success, adding `isError: true` on failure.

**NCBI Client** (`src/lib/ncbi.ts`) — Wraps the four E-utilities endpoints (`esearch`, `esummary`, `efetch`, `elink`) plus `pmidToPmcid`. All requests go through `rateLimitedFetch` (300ms delay without API key, 100ms with) with a 15s timeout. Every request includes `tool=pubcrawl` and `email=nick@pharmatools.ai`. Each function checks the cache before making a network call.

**XML Parser** (`src/lib/xml-parser.ts`) — Configures `fast-xml-parser` with `isArray` for elements that can appear once or multiple times in PubMed XML (Author, AbstractText, MeshHeading, Keyword, sec, fig, table-wrap, ref, etc.). This list is critical — if a new XML element needs consistent array handling, it must be added here. Provides two distinct author parsers: `parseAuthors` for efetch XML (`LastName`/`ForeName` elements) and `parseSummaryAuthors` for esummary JSON (`name` property).

**Europe PMC Client** (`src/lib/europepmc.ts`) — Wraps the Europe PMC REST API (`/search`, free, no auth). Covers a broader corpus than PubMed: journal articles (`source: MED`), preprints (`source: PPR`), full text in PMC (`source: PMC`), and patents. Rate-limited to one request per 200ms with cache. `searchEuropePmc` requests `resultType=core` (so each hit carries `abstractText`, `citedByCount`, `isOpenAccess`, `inEPMC`) and composes optional `AND (SRC:PPR)` / `AND (OPEN_ACCESS:Y)` filters into the query. The pure `formatEuropePmcResult` helper maps one `core` result to a `EuropePmcArticle` and is unit-tested against fixtures.

**ClinicalTrials.gov Client** (`src/lib/clinicaltrials.ts`) — Wraps ClinicalTrials.gov API v2 (free, no auth). Rate-limited to 1.2s between requests (~50 req/min). `searchTrials` queries `/studies` with condition/intervention/term filters and field limiting. `getTrialDetail` fetches a single study by NCT ID with full parsing of eligibility, design, arms, outcomes, and associated PMIDs. Both functions use the shared `studyToSummary` helper to parse the nested API response.

**Cache** (`src/lib/cache.ts`) — Singleton LRU cache (500 entries). TTLs: search/related/summary = 1 hour, trial details = 4 hours, abstracts/fulltext/labels = 24 hours.

**Server factory** (`src/server.ts`) — `createPubCrawlServer()` is the single place tools are registered; register a new tool here and both transports get it. `SERVER_VERSION` is read from `package.json`. `configureFromEnv()` applies `NCBI_API_KEY`.

**Entry points** — `src/index.ts` connects the server over `StdioServerTransport`. `src/http.ts` reads `PORT`, `HOST` and `PUBCRAWL_ALLOWED_ORIGINS`, starts the HTTP app and handles `SIGTERM`. `src/http-app.ts` exports `createHttpApp()` (no side effects, so tests can start it on port 0): stateless Streamable HTTP on `POST /mcp` with a fresh server per request, `GET /health`, CORS with an optional origin allowlist (403 for others), and 405 for `GET`/`DELETE` on `/mcp`.

**Container** — `Dockerfile` builds a non-root image running `dist/http.js` on port 8080. The CI `container` job builds it and checks health, user, handshake, tool count and clean stop. The README's "Run in your own environment" section lists every outbound host; update that table if a tool starts calling a new one.

**Agent Registry tool spec** — `src/toolspec.ts` builds the spec Google Cloud Agent Registry needs (name, description, annotations, input schema without parameter descriptions) over an in-memory MCP connection. `npm run build && npm run toolspec` regenerates `deploy/agent-registry/toolspec.json`; `tests/toolspec.test.ts` fails if that file is stale or over 10 KB, so rerun it after changing any tool's name, description or schema.

## Tool → API Mapping

| Tool | Pipeline |
|------|----------|
| `search_pubmed` | esearch → esummary |
| `search_europepmc` | Europe PMC `/search` (`resultType=core`), map each result via `formatEuropePmcResult` |
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
