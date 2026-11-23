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
the citation formatters (`cite.ts`), the ClinicalTrials.gov summary mapper
(`clinicaltrials.ts`), and the upstream client's retry and spacing (`upstream.ts`), plus `http.test.ts`, which starts the real HTTP app on a local port
and checks the transport and handshake (it calls no tools). Tests use fixture payloads —
no network calls. Functions that need testing are exported from their module; keep new
parsing/formatting logic as exported pure functions so it can be unit-tested the same way.
CI (`.github/workflows/build.yml`) runs lint → test → build on every push and PR, plus a `container` job that builds and smoke-tests the Docker image. A `published-package` job packs the release, installs it in an empty project on Node 20 and runs `scripts/consumer-smoke.mjs`, because npm users get cheerio's undici 7 on Node 20+ rather than this repo's Node 22 + undici 8 override.

## Architecture

The server has three layers:

**Tools** (`src/tools/`) — Each file exports a `register*Tool(server: McpServer)` function that registers one MCP tool with a zod schema and async handler. Handlers return `{ content: [{ type: "text", text: JSON.stringify(...) }] }` on success, adding `isError: true` on failure.

**NCBI Client** (`src/lib/ncbi.ts`) — Wraps the four E-utilities endpoints (`esearch`, `esummary`, `efetch`, `elink`) plus `pmidToPmcid`. All requests go through `rateLimitedFetch`, an upstream client (see below) with a 300ms delay without API key, 100ms with, and a 15s timeout. Every request includes `tool=pubcrawl` and `email=nick@pharmatools.ai`. Each function checks the cache before making a network call.

**XML Parser** (`src/lib/xml-parser.ts`) — Configures `fast-xml-parser` with `isArray` for elements that can appear once or multiple times in PubMed XML (Author, AbstractText, MeshHeading, Keyword, sec, fig, table-wrap, ref, etc.). This list is critical — if a new XML element needs consistent array handling, it must be added here. Provides two distinct author parsers: `parseAuthors` for efetch XML (`LastName`/`ForeName` elements) and `parseSummaryAuthors` for esummary JSON (`name` property).

**Upstream client** (`src/lib/upstream.ts`) — `createUpstreamClient({ name, errorPrefix, minDelayMs, timeoutMs, headers? })` returns the `rateLimitedFetch(url)` each API client uses: request spacing (slots are reserved before waiting, so it holds under concurrent calls), a timeout per attempt, `discardBody` on every error response, and retry on 429/500/502/503/504, network errors and timeouts (two retries with backoff and capped `Retry-After`; a timeout is retried once). Retries log an `upstream_retry` JSON line to stderr, never stdout. A new API client should create its fetch here and not write its own; `fetch`, `sleep`, `now` and `random` are injectable for tests (`tests/upstream.test.ts`).

**Publication status** (`src/lib/publication-status.ts`) — Pure functions that turn a source record into `{ retracted, warning?, notices? }`: `statusFromSummary` (esummary `pubtype` + `references`), `statusFromPubmedXml` (efetch `PublicationTypeList` + `CommentsCorrectionsList`) and `statusFromEuropePmc` (`pubTypeList` + `commentCorrectionList`), all funnelling into `buildPublicationStatus`. Every literature tool spreads the result into its output, with `retracted` always present; a tool that cannot check must say so (`get_full_text` returns `retracted: null`) and never default to false. Any new tool that returns articles should do the same.

**Europe PMC Client** (`src/lib/europepmc.ts`) — Wraps the Europe PMC REST API (`/search`, free, no auth). Covers a broader corpus than PubMed: journal articles (`source: MED`), preprints (`source: PPR`), full text in PMC (`source: PMC`), and patents. Rate-limited to one request per 200ms with cache; the timeout is 25s, longer than the other clients, because its search is slow at times. `europePmcErrorText` adds a pointer to `search_pubmed` when Europe PMC itself failed. `searchEuropePmc` requests `resultType=core` (so each hit carries `abstractText`, `citedByCount`, `isOpenAccess`, `inEPMC`) and composes optional `AND (SRC:PPR)` / `AND (OPEN_ACCESS:Y)` filters into the query. The pure `formatEuropePmcResult` helper maps one `core` result to a `EuropePmcArticle` and is unit-tested against fixtures.

**ClinicalTrials.gov Client** (`src/lib/clinicaltrials.ts`) — Wraps ClinicalTrials.gov API v2 (free, no auth). Rate-limited to 1.2s between requests (~50 req/min). `searchTrials` queries `/studies` with condition/intervention/term filters and field limiting. `getTrialDetail` fetches a single study by NCT ID with full parsing of eligibility, design, arms, outcomes, and associated PMIDs. Both functions use the shared `studyToSummary` helper to parse the nested API response.

**Cache** (`src/lib/cache.ts`) — Singleton LRU cache (500 entries). TTLs: search/related/summary = 1 hour, trial details = 4 hours, abstracts/fulltext/labels = 24 hours.

**Server factory** (`src/server.ts`) — `createPubCrawlServer()` is the single place tools are registered; register a new tool here and both transports get it. `SERVER_VERSION` is read from `package.json`. `configureFromEnv()` applies `NCBI_API_KEY`.

**Entry points** — `src/index.ts` connects the server over `StdioServerTransport`. `src/http.ts` reads `PORT`, `HOST` and `PUBCRAWL_ALLOWED_ORIGINS`, starts the HTTP app and handles `SIGTERM`. It also installs `src/lib/crash-guard.ts`, which logs and ignores one known undici 7 parser assertion (thrown from a socket event when an upstream closes a paused connection) so it cannot stop the server; every other uncaught exception still exits. The guard is a backstop: the cause is handled by `src/lib/discard-body.ts` (each fetch helper cancels an error response's body before throwing; never leave a response body unread) and by the `undici` 8 override in `package.json`, which is why development, CI and the Dockerfile use Node 22.19+ while the published package still supports Node 20+. `src/http-app.ts` exports `createHttpApp()` (no side effects, so tests can start it on port 0): stateless Streamable HTTP on `POST /mcp` with a fresh server per request, `GET /health`, CORS with an optional origin allowlist (403 for others), and 405 for `GET`/`DELETE` on `/mcp`. Each MCP `initialize` logs one JSON usage line to stdout via `src/lib/usage.ts` (client name/version and daily counts; nothing about the user or query), and each completed tool call logs one too (tool name, `ok`, duration and daily counts; never arguments or results); `PUBCRAWL_USAGE_LOG=off` disables both. Tool calls are reported through `createPubCrawlServer({ onToolCall })`, which wraps every handler at registration (`instrumentTools` in `src/server.ts`), so a new tool is counted with no extra code.

**Container** — `Dockerfile` builds a non-root image running `dist/http.js` on port 8080; Railway deploys from it (`railway.toml`). The CI `container` job builds it and checks health, user, handshake, tool count and clean stop. The README's "Run in your own environment" section lists every outbound host; update that table if a tool starts calling a new one.

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
