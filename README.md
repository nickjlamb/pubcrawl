# PubCrawl

A peer-reviewed pub crawl through the literature — an [MCP server](https://modelcontextprotocol.io) that gives LLM clients access to PubMed and biomedical literature via NCBI E-utilities.

Built by [PharmaTools.AI](https://pharmatools.ai).

## Tools

| Tool | What it does |
|------|-------------|
| `search_pubmed` | Search PubMed with filters for date range, article type, and sort order. Returns PMIDs, titles, authors, journals, and DOIs. |
| `get_abstract` | Get the full structured abstract for an article — broken into labeled sections (background, methods, results, conclusions) with keywords and MeSH terms. |
| `get_full_text` | Retrieve the full text of open-access articles from PubMed Central, with parsed sections, figure/table captions, and reference counts. |
| `find_related` | Find similar articles using PubMed's neighbor algorithm, ranked by relevance score. |
| `format_citation` | Generate a formatted citation in APA, Vancouver, Harvard, or BibTeX style. |
| `trending_papers` | Find recent papers on a topic, with optional filtering to high-impact journals (Nature, Science, Cell, NEJM, Lancet, JAMA, etc.). |

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

## Development

```bash
npm run dev    # TypeScript watch mode
npm run build  # Compile to dist/
npm start      # Run the server
```

## License

MIT
