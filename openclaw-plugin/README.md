# PubCrawl — OpenClaw plugin

Biomedical research tools for OpenClaw agents: PubMed literature search, ClinicalTrials.gov, and US (FDA) / UK (eMC) drug labelling. Built by [PharmaTools.AI](https://pharmatools.ai).

This is the OpenClaw plugin build of the [PubCrawl MCP server](https://www.pharmatools.ai/pubcrawl). It reuses the same data layer and exposes 12 agent-callable tools natively, so any OpenClaw agent can search the literature and drug labels without an external MCP process.

## Tools

| Tool | What it does |
|------|--------------|
| `search_pubmed` | Search PubMed; returns PMIDs, titles, authors, journals, DOIs |
| `get_abstract` | Structured abstract, keywords, MeSH terms, PMC ID for a PMID |
| `get_full_text` | Open-access full text from PubMed Central (sections, captions, ref count) |
| `find_related` | Related papers for a PMID, ranked by PubMed's neighbor score |
| `format_citation` | Format a PMID as APA, Vancouver, Harvard, or BibTeX |
| `trending_papers` | Recent papers on a topic, optionally high-impact journals only |
| `get_uspi` | FDA US Prescribing Information from DailyMed (LOINC-coded sections) |
| `get_smpc` | UK/EU Summary of Product Characteristics from eMC |
| `compare_labels` | US PI vs UK SmPC side-by-side, with mapped sections |
| `search_by_indication` | Drugs approved for a condition, with US/UK availability |
| `search_trials` | Search ClinicalTrials.gov by condition, intervention, status, phase |
| `get_trial` | Full trial detail by NCT ID (eligibility, design, arms, outcomes, PMIDs) |

All tools are read-only and hit public APIs (NCBI E-utilities, openFDA, DailyMed, eMC, ClinicalTrials.gov v2).

## Install

```bash
# From ClawHub (preferred)
openclaw plugins install clawhub:nickjlamb/openclaw-pubcrawl

# From npm
openclaw plugins install npm:@nickjlamb/openclaw-pubcrawl

# Local checkout (development)
openclaw plugins install --link ./openclaw-plugin
```

Restart the Gateway if it doesn't reload automatically:

```bash
openclaw gateway restart
openclaw plugins inspect pubcrawl --runtime
```

## Configuration

All tools work with no configuration. To raise the PubMed rate limit from 3 to 10 requests/second, add a free [NCBI API key](https://www.ncbi.nlm.nih.gov/account/):

```jsonc
{
  plugins: {
    entries: {
      pubcrawl: {
        config: { ncbiApiKey: "your-ncbi-key" },
      },
    },
  },
}
```

## Build from source

Requires Node >= 22.

```bash
npm install
npm run build              # tsc -> dist/
npm run plugin:build       # regenerate openclaw.plugin.json from the entry
npm run plugin:validate    # verify manifest matches the built entry
```

`plugin:build` and `plugin:validate` require the `openclaw` CLI (installed as a peer dependency). Always commit `openclaw.plugin.json` and `package.json` after running `plugin:build`.

## Publish to ClawHub

```bash
npm run build
npm run plugin:build
clawhub package publish nickjlamb/openclaw-pubcrawl --dry-run
clawhub package publish nickjlamb/openclaw-pubcrawl
```

## Relationship to the MCP server

The `src/lib/*` modules are copied from the PubCrawl MCP server and are the source of truth for API access, parsing, and caching. Only the tool-registration layer differs: the MCP server uses `McpServer.tool()` with zod schemas; this plugin uses `defineToolPlugin` with TypeBox schemas. Keep the two `lib` copies in sync when the upstream server changes.

## License

MIT — built by [PharmaTools.AI](https://pharmatools.ai).
