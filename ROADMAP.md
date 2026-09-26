# Roadmap

PubCrawl's direction: broaden the primary sources it can reach, deepen what each tool returns, and make it feel like a workflow rather than a set of API wrappers — while keeping every result verifiable.

This is a living document, not a commitment. Priorities shift with feedback; [open an issue](https://github.com/nickjlamb/pubcrawl/issues/new/choose) to suggest or upvote something.

## ✅ Recently shipped

- **Fidelity benchmark for labelling and trials** (`benchmark/`) — `compare_labels` gold set with verbatim-against-source checks, trial-record anchors, and a CI gate on release
- **`compare_labels` status semantics** — a missing side is always explained (label unavailable vs section absent)
- **`search_europepmc`** — search Europe PMC (preprints, patents, richer metadata) alongside PubMed
- **Test suite + CI** — Vitest unit tests and ESLint, run on every push and PR
- Fixed the `abstract_snippet` bug in the PubMed summary tools

## 🎯 Near term

- **`get_preprint_fulltext`** — read the full text of bioRxiv/medRxiv preprints via their native APIs. Preprints are the real gap here: `get_full_text` already covers PMC open-access articles, and while Europe PMC indexes preprints, it doesn't expose their full text as XML — so reading a preprint needs the preprint servers' own APIs.
- **`get_adverse_events`** — openFDA FAERS adverse-event reports for a drug; a natural follow-on to the labelling tools
- **MeSH query helper** — resolve terms to MeSH and help build precise PubMed queries (search quality lives and dies on MeSH)

## 🔭 Exploring

- **EMA / EPAR labelling** — add the EU centralised label to complement the US + UK `compare_labels`
- **MCP resources** — expose abstracts, trials, and labels as addressable resources the model can re-reference
- **MCP prompts** — packaged workflows (e.g. "literature review on X" chaining search → abstracts → related → citations)
- **Citation graph** — forward/backward citations via Europe PMC or OpenCitations
- **Structured full-text extraction** — pull specific sections (methods, results) rather than the whole article

## 🧱 Infrastructure

- `@pharmatools/drug-data` 0.3: expose the per-section character cap (currently 1,400) so PubCrawl can return whole sections; typed failure reasons (not-found vs unreachable); stricter eMC/openFDA best-match so a generic doesn't resolve to an OTC or combination product
- Response schema validation on outbound tool results
- Coverage reporting in CI
- Optional persistent cache for hosted deployments

---

Have a source you'd like PubCrawl to reach, or a workflow it should support? [File an issue](https://github.com/nickjlamb/pubcrawl/issues/new/choose) — real use cases shape this list.
