# Security Policy

## Reporting a vulnerability

If you believe you've found a security vulnerability in PubCrawl, please report it privately rather than opening a public issue.

- Use GitHub's [private vulnerability reporting](https://github.com/nickjlamb/pubcrawl/security/advisories/new), or
- Email **nick@pharmatools.ai** with the details.

Please include a description, reproduction steps, and the potential impact. You'll get an acknowledgement as soon as possible, and we'll keep you updated as the issue is investigated and resolved.

## Scope

PubCrawl is a read-only MCP server that queries public biomedical APIs (NCBI E-utilities, Europe PMC, openFDA, DailyMed, the UK eMC, and ClinicalTrials.gov). It stores no user data and requires no credentials beyond an optional NCBI API key supplied via environment variable. Reports most relevant to this project include: request handling in the HTTP transport, dependency vulnerabilities, and any path by which untrusted input could cause unintended behaviour.

## Supported versions

The latest published version on npm receives security updates.
