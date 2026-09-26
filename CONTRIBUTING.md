# Contributing to PubCrawl

Thanks for your interest in improving PubCrawl! Bug reports, new data sources, and new tools are all welcome. This guide gets you productive quickly.

## Ground rules

- **Be kind.** Assume good intent; keep discussion constructive.
- **One logical change per PR.** Small, focused PRs are easier to review and land faster.
- **Everything cites its source.** PubCrawl's value is verifiable, primary-source data — tools must return results traceable to an official API, never fabricated or inferred content.

## Getting started

```bash
git clone https://github.com/nickjlamb/pubcrawl.git
cd pubcrawl
npm install

npm run dev      # TypeScript watch mode
npm run build    # compile to dist/
npm test         # Vitest unit suite
npm run lint     # ESLint
```

Requires **Node.js 20+**. No API keys are needed for development (an optional free NCBI key raises PubMed rate limits — see the README).

## Project layout

```
src/
  index.ts        # stdio entry point — registers every tool
  http.ts         # Streamable HTTP entry point — registers the SAME tools
  tools/          # one file per MCP tool: register*Tool(server)
  lib/            # API clients (ncbi, europepmc, openfda, dailymed, emc,
                  #   clinicaltrials), plus cache + xml-parser
  types.ts        # shared return-type interfaces
tests/            # Vitest fixture-based unit tests
benchmark/        # online fidelity benchmark (labels + trials), run on release
```

See [`CLAUDE.md`](CLAUDE.md) for a deeper architecture walkthrough.

## Adding a new tool

1. **Client** — add or extend an API client in `src/lib/`. Route every request through a rate-limited, cached, time-bounded fetch (follow the existing clients). Export any pure mapping/formatting logic as a standalone function so it can be unit-tested.
2. **Tool** — create `src/tools/<name>.ts` exporting `register<Name>Tool(server)`:
   - Define inputs with a `zod` schema and clear `.describe()` text (the model reads these).
   - Set the annotation hints (`readOnlyHint`, `destructiveHint`, `openWorldHint`).
   - Return `{ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }` on success; add `isError: true` on failure.
3. **Register in both entry points** — add the import + `register...` call to **`src/index.ts` and `src/http.ts`**. Keeping the two lists in sync is required; a tool missing from `http.ts` won't be available over the HTTP transport.
4. **Types** — add shared return interfaces to `src/types.ts`.
5. **Tests** — add fixture-based tests in `tests/` for the pure logic (see below).
6. **Docs** — add a row to the README tool table and, if it changes the pipeline, a note in `CLAUDE.md`.

## Testing conventions

- Tests use **Vitest** with **fixture payloads** — no live network calls. This keeps CI deterministic.
- Keep parsing/formatting logic in **exported pure functions** and test those directly (e.g. `formatSummaryArticle`, `formatEuropePmcResult`, the citation formatters, `studyToSummary`). This is the pattern to follow for anything new.
- Add a regression test when you fix a bug, so it can't come back.
- Run `npm test` and `npm run lint` before opening a PR. CI runs lint → test → build and must be green to merge.

## Coding conventions

- **ESM throughout** (`"type": "module"`). All local imports use **`.js` extensions**, even for `.ts` files (`moduleResolution: "Node16"`).
- Prefer `unknown` + explicit narrowing over `any`.
- Match the style of the surrounding file; `npm run lint` is the arbiter.

## Commit & PR process

1. Branch off `main`: `git checkout -b my-change`.
2. Make your change with tests; keep commits focused.
3. Push and open a PR against `main`. Fill out the PR template.
4. Ensure CI is green. A maintainer will review.

Conventional, descriptive commit messages are appreciated (e.g. `Add get_adverse_events tool (openFDA FAERS)`).

## Reporting bugs & requesting features

Use the [issue templates](https://github.com/nickjlamb/pubcrawl/issues/new/choose). For bugs, include the tool name, the input you used, what you expected, and what you got. For security issues, see [`SECURITY.md`](SECURITY.md) — please do **not** open a public issue.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
