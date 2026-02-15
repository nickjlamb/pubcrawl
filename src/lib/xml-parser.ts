import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  isArray: (name) => {
    const arrayTags = [
      "PubmedArticle",
      "Author",
      "AbstractText",
      "MeshHeading",
      "Keyword",
      "sec",
      "fig",
      "table-wrap",
      "ref",
      "IdList",
      "Link",
      "LinkSet",
    ];
    return arrayTags.includes(name);
  },
  trimValues: true,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseXml(xml: string): any {
  return parser.parse(xml);
}

export function extractText(node: unknown): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (node === null || node === undefined) return "";

  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if ("#text" in obj) return String(obj["#text"]);

    // Concatenate text from child elements
    const parts: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
      if (!key.startsWith("@_")) {
        if (Array.isArray(value)) {
          parts.push(value.map(extractText).join(" "));
        } else {
          parts.push(extractText(value));
        }
      }
    }
    return parts.join(" ").trim();
  }

  return String(node);
}

function ensureArray<T>(val: T | T[] | undefined | null): T[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

export function parseAuthors(authorList: unknown): string[] {
  if (!authorList) return [];

  const list = (authorList as Record<string, unknown>)?.Author;
  const authors = ensureArray(list);

  return authors.map((a: unknown) => {
    const author = a as Record<string, unknown>;
    const last = author.LastName ? String(author.LastName) : "";
    const first = author.ForeName ? String(author.ForeName) : "";
    const initials = author.Initials ? String(author.Initials) : "";
    if (last && first) return `${last} ${first}`;
    if (last && initials) return `${last} ${initials}`;
    // CollectiveName for group authors
    if (author.CollectiveName) return String(author.CollectiveName);
    return last || first || "";
  }).filter(Boolean);
}

export function parseSummaryAuthors(authors: unknown): string[] {
  if (!authors) return [];
  const list = ensureArray(authors);
  return list.map((a: unknown) => {
    if (typeof a === "string") return a;
    const author = a as Record<string, unknown>;
    return author.name ? String(author.name) : extractText(a);
  }).filter(Boolean);
}

export function parseAbstractSections(abstractNode: unknown): Array<{ label: string; text: string }> {
  if (!abstractNode) return [];

  const obj = abstractNode as Record<string, unknown>;
  const textNodes = obj.AbstractText;

  if (!textNodes) return [];

  const sections = ensureArray(textNodes);

  return sections.map((section: unknown) => {
    if (typeof section === "string") {
      return { label: "", text: section };
    }

    const s = section as Record<string, unknown>;
    const label = s["@_Label"] ? String(s["@_Label"]) : "";
    const text = extractText(section);
    return { label, text };
  });
}

export function parseMeshTerms(meshList: unknown): string[] {
  if (!meshList) return [];

  const headings = ensureArray((meshList as Record<string, unknown>)?.MeshHeading);

  return headings.map((h: unknown) => {
    const heading = h as Record<string, unknown>;
    const descriptor = heading.DescriptorName;
    return extractText(descriptor);
  }).filter(Boolean);
}

export function parseKeywords(keywordList: unknown): string[] {
  if (!keywordList) return [];

  const keywords = ensureArray((keywordList as Record<string, unknown>)?.Keyword);
  return keywords.map(extractText).filter(Boolean);
}

export function parseJatsSections(body: unknown): Array<{ title: string; content: string }> {
  if (!body) return [];

  const obj = body as Record<string, unknown>;
  const sections = ensureArray(obj.sec);

  return sections.map((sec: unknown) => {
    const s = sec as Record<string, unknown>;
    const title = s.title ? extractText(s.title) : "";
    const content = extractJatsContent(s);
    return { title, content };
  });
}

function extractJatsContent(node: unknown): string {
  if (!node || typeof node !== "object") return extractText(node);

  const obj = node as Record<string, unknown>;
  const parts: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (key === "title" || key.startsWith("@_")) continue;

    if (key === "p") {
      const paragraphs = ensureArray(value);
      parts.push(...paragraphs.map(extractText));
    } else if (key === "sec") {
      // Nested sections
      const subsections = ensureArray(value);
      for (const sub of subsections) {
        const subObj = sub as Record<string, unknown>;
        if (subObj.title) parts.push(`\n### ${extractText(subObj.title)}`);
        parts.push(extractJatsContent(sub));
      }
    }
  }

  return parts.join("\n\n");
}

export function parseFigureCaptions(body: unknown): string[] {
  if (!body) return [];
  const figures = findAllElements(body, "fig");
  return figures.map((fig) => {
    const f = fig as Record<string, unknown>;
    const label = f.label ? extractText(f.label) : "";
    const caption = f.caption ? extractText(f.caption) : "";
    return label ? `${label}: ${caption}` : caption;
  }).filter(Boolean);
}

export function parseTableCaptions(body: unknown): string[] {
  if (!body) return [];
  const tables = findAllElements(body, "table-wrap");
  return tables.map((tw) => {
    const t = tw as Record<string, unknown>;
    const label = t.label ? extractText(t.label) : "";
    const caption = t.caption ? extractText(t.caption) : "";
    return label ? `${label}: ${caption}` : caption;
  }).filter(Boolean);
}

export function countReferences(back: unknown): number {
  if (!back) return 0;
  const refs = findAllElements(back, "ref");
  return refs.length;
}

function findAllElements(node: unknown, tagName: string): unknown[] {
  const results: unknown[] = [];
  if (!node || typeof node !== "object") return results;

  const obj = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (key === tagName) {
      const items = ensureArray(value);
      results.push(...items);
    } else if (typeof value === "object" && value !== null) {
      if (Array.isArray(value)) {
        for (const item of value) {
          results.push(...findAllElements(item, tagName));
        }
      } else {
        results.push(...findAllElements(value, tagName));
      }
    }
  }

  return results;
}
