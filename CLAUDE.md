# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PubCrawl is an MCP (Model Context Protocol) server that gives LLM clients (Claude Desktop, Cursor, etc.) access to PubMed and biomedical literature via NCBI E-utilities. Built by PharmaTools.AI.

## Commands

- `npm run build` — compile TypeScript (`src/`) to `dist/`
- `npm start` — run the compiled MCP server via stdio
- `npm run dev` — `tsc --watch` for development

No test framework or linter is configured.

## Architecture

The server has three layers:

**Tools** (`src/tools/`) — Each file exports a `register*Tool(server: McpServer)` function that registers one MCP tool with a zod schema and async handler. Handlers return `{ content: [{ type: "text", text: JSON.stringify(...) }] }` on success, adding `isError: true` on failure.

**NCBI Client** (`src/lib/ncbi.ts`) — Wraps the four E-utilities endpoints (`esearch`, `esummary`, `efetch`, `elink`) plus `pmidToPmcid`. All requests go through `rateLimitedFetch` (300ms delay without API key, 100ms with) with a 15s timeout. Every request includes `tool=pubcrawl` and `email=nick@pharmatools.ai`. Each function checks the cache before making a network call.

**XML Parser** (`src/lib/xml-parser.ts`) — Configures `fast-xml-parser` with `isArray` for elements that can appear once or multiple times in PubMed XML (Author, AbstractText, MeshHeading, Keyword, sec, fig, table-wrap, ref, etc.). This list is critical — if a new XML element needs consistent array handling, it must be added here. Provides two distinct author parsers: `parseAuthors` for efetch XML (`LastName`/`ForeName` elements) and `parseSummaryAuthors` for esummary JSON (`name` property).

**Cache** (`src/lib/cache.ts`) — Singleton LRU cache (500 entries). TTLs: search/related/summary = 1 hour, abstracts/fulltext = 24 hours.

**Entry point** (`src/index.ts`) — Creates `McpServer`, loads optional `NCBI_API_KEY` from env, registers all six tools, connects via `StdioServerTransport`.

## Tool → API Mapping

| Tool | NCBI Pipeline |
|------|--------------|
| `search_pubmed` | esearch → esummary |
| `get_abstract` | efetch rettype=xml, parse `AbstractText` with `@_Label` attributes |
| `get_full_text` | elink (PMID→PMCID) → efetch db=pmc rettype=xml, parse JATS `<sec>` elements |
| `find_related` | elink cmd=neighbor_score → esummary |
| `format_citation` | efetch rettype=xml, format as APA/Vancouver/Harvard/BibTeX |
| `trending_papers` | esearch (date-sorted) → esummary |

## Key Conventions

- ESM modules throughout (`"type": "module"`). All local imports use `.js` extensions.
- TypeScript uses `module: "Node16"` / `moduleResolution: "Node16"`.
- Shared return-type interfaces live in `src/types.ts`.
- `esearch` and `esummary` use `retmode=json`; `efetch` returns XML.
