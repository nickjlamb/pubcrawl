// Citation formatters ported from the PubCrawl MCP server (src/tools/cite.ts).
// Kept as a standalone module so the plugin entry stays readable.

export interface ArticleInfo {
  authors: string[];
  title: string;
  journal: string;
  year: string;
  volume: string;
  issue: string;
  pages: string;
  doi: string;
  pmid: string;
}

export function formatApa(info: ArticleInfo): string {
  const authorStr = info.authors.length === 0
    ? ""
    : info.authors.length <= 7
      ? info.authors.map((a) => {
          const parts = a.split(" ");
          const last = parts[0];
          const initials = parts.slice(1).map((p) => p[0] + ".").join(" ");
          return `${last}, ${initials}`;
        }).join(", ")
      : info.authors.slice(0, 6).map((a) => {
          const parts = a.split(" ");
          const last = parts[0];
          const initials = parts.slice(1).map((p) => p[0] + ".").join(" ");
          return `${last}, ${initials}`;
        }).join(", ") + ", ... " + (() => {
          const last = info.authors[info.authors.length - 1];
          const parts = last.split(" ");
          const lastName = parts[0];
          const initials = parts.slice(1).map((p) => p[0] + ".").join(" ");
          return `${lastName}, ${initials}`;
        })();

  const yearPart = info.year ? ` (${info.year}).` : ".";
  const titlePart = info.title.endsWith(".") ? ` ${info.title}` : ` ${info.title}.`;
  const journalPart = ` *${info.journal}*`;
  const volPart = info.volume ? `, *${info.volume}*` : "";
  const issuePart = info.issue ? `(${info.issue})` : "";
  const pagesPart = info.pages ? `, ${info.pages}` : "";
  const doiPart = info.doi ? ` https://doi.org/${info.doi}` : "";

  return `${authorStr}${yearPart}${titlePart}${journalPart}${volPart}${issuePart}${pagesPart}.${doiPart}`.trim();
}

export function formatVancouver(info: ArticleInfo): string {
  const authorStr = info.authors.length === 0
    ? ""
    : info.authors.length <= 6
      ? info.authors.map((a) => {
          const parts = a.split(" ");
          const last = parts[0];
          const initials = parts.slice(1).map((p) => p[0]).join("");
          return `${last} ${initials}`;
        }).join(", ")
      : info.authors.slice(0, 6).map((a) => {
          const parts = a.split(" ");
          const last = parts[0];
          const initials = parts.slice(1).map((p) => p[0]).join("");
          return `${last} ${initials}`;
        }).join(", ") + ", et al";

  const titlePart = info.title.endsWith(".") ? ` ${info.title}` : ` ${info.title}.`;
  const journalPart = ` ${info.journal}.`;
  const yearPart = info.year ? ` ${info.year}` : "";
  const volPart = info.volume ? `;${info.volume}` : "";
  const issuePart = info.issue ? `(${info.issue})` : "";
  const pagesPart = info.pages ? `:${info.pages}` : "";
  const doiPart = info.doi ? ` doi:${info.doi}` : "";

  return `${authorStr}.${titlePart}${journalPart}${yearPart}${volPart}${issuePart}${pagesPart}.${doiPart}`.trim();
}

export function formatHarvard(info: ArticleInfo): string {
  const authorStr = info.authors.length === 0
    ? ""
    : info.authors.length <= 3
      ? info.authors.map((a) => {
          const parts = a.split(" ");
          const last = parts[0];
          const initials = parts.slice(1).map((p) => p[0] + ".").join("");
          return `${last}, ${initials}`;
        }).join(", ")
      : (() => {
          const first = info.authors[0];
          const parts = first.split(" ");
          const last = parts[0];
          const initials = parts.slice(1).map((p) => p[0] + ".").join("");
          return `${last}, ${initials} et al.`;
        })();

  const yearPart = info.year ? ` ${info.year}.` : ".";
  const titlePart = ` '${info.title}'.`;
  const journalPart = ` *${info.journal}*`;
  const volPart = info.volume ? `, ${info.volume}` : "";
  const issuePart = info.issue ? `(${info.issue})` : "";
  const pagesPart = info.pages ? `, pp. ${info.pages}` : "";
  const doiPart = info.doi ? `. doi:${info.doi}` : "";

  return `${authorStr}${yearPart}${titlePart}${journalPart}${volPart}${issuePart}${pagesPart}${doiPart}`.trim();
}

export function formatBibtex(info: ArticleInfo): string {
  const key = info.authors.length > 0
    ? info.authors[0].split(" ")[0].toLowerCase() + info.year
    : `pmid${info.pmid}`;

  const authorStr = info.authors.map((a) => {
    const parts = a.split(" ");
    return `${parts[0]}, ${parts.slice(1).join(" ")}`;
  }).join(" and ");

  const lines = [
    `@article{${key},`,
    `  author  = {${authorStr}},`,
    `  title   = {${info.title}},`,
    `  journal = {${info.journal}},`,
    `  year    = {${info.year}},`,
  ];

  if (info.volume) lines.push(`  volume  = {${info.volume}},`);
  if (info.issue) lines.push(`  number  = {${info.issue}},`);
  if (info.pages) lines.push(`  pages   = {${info.pages}},`);
  if (info.doi) lines.push(`  doi     = {${info.doi}},`);
  lines.push(`  pmid    = {${info.pmid}},`);
  lines.push(`}`);

  return lines.join("\n");
}

export const citationFormatters: Record<string, (info: ArticleInfo) => string> = {
  apa: formatApa,
  vancouver: formatVancouver,
  harvard: formatHarvard,
  bibtex: formatBibtex,
};
