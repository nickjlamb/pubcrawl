# PubCrawl

An [MCP server](https://modelcontextprotocol.io) that gives LLM clients access to PubMed, FDA drug labelling, and UK medicines data. A peer-reviewed pub crawl through the literature — and the label.

Built by [PharmaTools.AI](https://pharmatools.ai).

## Tools

### Literature

| Tool | What it does |
|------|-------------|
| `search_pubmed` | Search PubMed with filters for date range, article type, and sort order. Returns PMIDs, titles, authors, journals, and DOIs. |
| `get_abstract` | Get the full structured abstract for an article — broken into labeled sections (background, methods, results, conclusions) with keywords and MeSH terms. |
| `get_full_text` | Retrieve the full text of open-access articles from PubMed Central, with parsed sections, figure/table captions, and reference counts. |
| `find_related` | Find similar articles using PubMed's neighbor algorithm, ranked by relevance score. |
| `format_citation` | Generate a formatted citation in APA, Vancouver, Harvard, or BibTeX style. |
| `trending_papers` | Find recent papers on a topic, with optional filtering to high-impact journals (Nature, Science, Cell, NEJM, Lancet, JAMA, etc.). |

### Drug Labelling

| Tool | What it does |
|------|-------------|
| `get_uspi` | Pull US Prescribing Information sections from DailyMed — indications, dosing, warnings, contraindications, and more. Parsed from FDA structured product labels. |
| `get_smpc` | Retrieve UK Summary of Product Characteristics from the eMC — the UK equivalent of US prescribing information, with numbered SmPC sections. |
| `compare_labels` | Side-by-side comparison of US (USPI) and UK (SmPC) labelling for the same drug. Spot regulatory differences in indications, warnings, and dosing. |
| `search_by_indication` | Find drugs approved for a medical condition. Searches FDA labelling via OpenFDA, then cross-references UK availability on the eMC. |

## Setup

### Prerequisites

- Node.js 18+
- An MCP-compatible client (Claude Desktop, Cursor, etc.)

### Install and build

```bash
git clone https://github.com/nickjlamb/pubcrawl.git
cd pubcrawl
npm install
npm run build
```

### Configure Claude Desktop

Add to your `claude_desktop_config.json`:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "pubcrawl": {
      "command": "node",
      "args": ["/path/to/pubcrawl/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop. PubCrawl will appear under **+ → Connectors**.

### NCBI API key (optional)

Without an API key, requests are rate-limited to 3/second. With one, you get 10/second.

1. Create a free NCBI account at https://www.ncbi.nlm.nih.gov/account/
2. Go to Account Settings → API Key Management
3. Add the key to your config:

```json
{
  "mcpServers": {
    "pubcrawl": {
      "command": "node",
      "args": ["/path/to/pubcrawl/dist/index.js"],
      "env": {
        "NCBI_API_KEY": "your_key_here"
      }
    }
  }
}
```

## Example prompts

Once connected, just ask naturally:

- "Search PubMed for recent clinical trials on semaglutide"
- "Get the abstract for PMID 38127654"
- "Find papers related to this one and format citations in APA"
- "What are the trending papers on CRISPR gene therapy this month?"
- "Get the full text of that paper from PMC"
- "Get the FDA prescribing information for metformin — just the indications and warnings"
- "Pull the UK SmPC for atorvastatin"
- "Compare US and UK labelling for lisinopril"
- "What drugs are approved for type 2 diabetes?"

## Development

```bash
npm run dev    # TypeScript watch mode
npm run build  # Compile to dist/
npm start      # Run the server
```

## License

MIT
