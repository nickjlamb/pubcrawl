# Roadmap

PubCrawl's direction: broaden the primary sources it can reach, deepen what each tool returns, and make it feel like a workflow rather than a set of API wrappers — while keeping every result verifiable.

This is a living document, not a commitment. Priorities shift with feedback; [open an issue](https://github.com/nickjlamb/pubcrawl/issues/new/choose) to suggest or upvote something.

## ✅ Recently shipped

- **`search_europepmc`** — search Europe PMC (preprints, patents, richer metadata) alongside PubMed
- **Test suite + CI** — Vitest unit tests and ESLint, run on every push and PR
- Fixed the `abstract_snippet` bug in the PubMed summary tools

## 🎯 Near term

- **`get_europepmc_fulltext`** — read the full text of preprints and open-access articles surfaced by `search_europepmc` (today `get_full_text` is PMC-only, so preprints can be found but not read)
- **`get_adverse_events`** — openFDA FAERS adverse-event reports for a drug; a natural follow-on to the labelling tools
- **MeSH query helper** — resolve terms to MeSH and help build precise PubMed queries (search quality lives and dies on MeSH)

## 🔭 Exploring

- **EMA / EPAR labelling** — add the EU centralised label to complement the US + UK `compare_labels`
- **MCP resources** — expose abstracts, trials, and labels as addressable resources the model can re-reference
- **MCP prompts** — packaged workflows (e.g. "literature review on X" chaining search → abstracts → related → citations)
- **Citation graph** — forward/backward citations via Europe PMC or OpenCitations
- **Structured full-text extraction** — pull specific sections (methods, results) rather than the whole article

## 🧱 Infrastructure

- Response schema validation on outbound tool results
- Coverage reporting in CI
- Optional persistent cache for hosted deployments

---

Have a source you'd like PubCrawl to reach, or a workflow it should support? [File an issue](https://github.com/nickjlamb/pubcrawl/issues/new/choose) — real use cases shape this list.
