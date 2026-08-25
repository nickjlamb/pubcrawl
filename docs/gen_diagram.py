"""Generate docs/architecture-{light,dark}.svg for the README.

Three layers: MCP transport, 14 tools in three families, shared cache and
parsers — every tool a thin deterministic wrapper over an official API.
Hand-tuned layout; run from the repo root after editing:
    python3 docs/gen_diagram.py
"""

import os

FONT = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif"

THEMES = {
    "light": dict(
        text="#1f2328", muted="#59636e", border="#d0d7de", panel="#f6f8fa",
        node="#ffffff", accent="#8250df", accent_soft="#fbf0ff",
        green="#1a7f37",
        edge="#8c959f",
    ),
    "dark": dict(
        text="#e6edf3", muted="#9198a1", border="#3d444d", panel="#151b23",
        node="#212830", accent="#ab7df8", accent_soft="#2a2139",
        green="#3fb950",
        edge="#767d86",
    ),
}

W, H = 960, 520


def build(c: dict) -> str:
    s = []
    s.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
        f'font-family="{FONT}" role="img" '
        'aria-label="PubCrawl architecture: an MCP client connects over stdio or '
        'streamable HTTP to the PubCrawl server, whose 14 tools are grouped into '
        'literature, drug labelling and clinical trials. Each family calls the '
        'official APIs directly — NCBI E-utilities, Europe PMC, openFDA and '
        'DailyMed, the UK eMC, and ClinicalTrials.gov — behind a shared LRU cache, '
        'XML/JATS/SPL parsers and rate limits. Every result returns with its own '
        'identifier: PMID, NCT or DOI. No model sits in this path; nothing is '
        'invented.">'
    )
    s.append(
        '<defs>'
        f'<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" '
        f'markerHeight="7" orient="auto-start-reverse">'
        f'<path d="M0,0 L10,5 L0,10 z" fill="{c["edge"]}"/></marker>'
        f'<marker id="arr-green" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" '
        f'markerHeight="7" orient="auto-start-reverse">'
        f'<path d="M0,0 L10,5 L0,10 z" fill="{c["green"]}"/></marker>'
        '</defs>'
    )

    def panel(x, y, w, h, title):
        s.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" '
            f'fill="{c["panel"]}" stroke="{c["border"]}"/>'
        )
        s.append(
            f'<text x="{x + 18}" y="{y + 26}" font-size="11" font-weight="600" '
            f'letter-spacing="1.5" fill="{c["muted"]}">{title}</text>'
        )

    def node(cx, y, w, h, title, sub=None, fill=None, stroke=None, tcol=None):
        fill = fill or c["node"]
        stroke = stroke or c["border"]
        tcol = tcol or c["text"]
        x = cx - w / 2
        s.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" '
            f'fill="{fill}" stroke="{stroke}"/>'
        )
        if sub:
            s.append(
                f'<text x="{cx}" y="{y + 22}" font-size="13" font-weight="600" '
                f'text-anchor="middle" fill="{tcol}">{title}</text>'
            )
            s.append(
                f'<text x="{cx}" y="{y + 40}" font-size="11" '
                f'text-anchor="middle" fill="{c["muted"]}">{sub}</text>'
            )
        else:
            s.append(
                f'<text x="{cx}" y="{y + h / 2 + 4.5}" font-size="13" font-weight="600" '
                f'text-anchor="middle" fill="{tcol}">{title}</text>'
            )

    def elbow(points, marker="arr", color=None, dash=False):
        color = color or c["edge"]
        pts = " ".join(f"{x},{y}" for x, y in points)
        extra = ' stroke-dasharray="5 4"' if dash else ""
        s.append(
            f'<polyline points="{pts}" fill="none" stroke="{color}" '
            f'stroke-width="1.5"{extra} marker-end="url(#{marker})"/>'
        )

    # ---------------- client ----------------
    panel(16, 52, 170, 400, "MCP CLIENT")
    node(101, 200, 140, 56, "Your assistant", "Claude &#183; Cursor")
    s.append(
        f'<text x="116" y="290" font-size="11" font-style="italic" '
        f'fill="{c["muted"]}" text-anchor="middle">&#8220;Compare US and UK&#8221;</text>'
    )
    s.append(
        f'<text x="116" y="306" font-size="11" font-style="italic" '
        f'fill="{c["muted"]}" text-anchor="middle">&#8220;labelling for this drug&#8221;</text>'
    )

    # ---------------- server ----------------
    panel(216, 52, 390, 400, "PUBCRAWL MCP SERVER")
    scx = 421
    node(scx, 88, 300, 44, "stdio &#183; streamable HTTP")
    elbow([(171, 228), (196, 228), (196, 110), (269, 110)])
    s.append(
        f'<text x="186" y="170" font-size="11" fill="{c["muted"]}" '
        f'text-anchor="middle" transform="rotate(-90 186 170)">MCP</text>'
    )
    families = [
        (156, "Literature &#183; 7 tools", "search &#183; abstract &#183; full text &#183; cite"),
        (224, "Drug labelling &#183; 5 tools", "USPI &#183; SmPC &#183; compare &#183; resolve"),
        (292, "Clinical trials &#183; 2 tools", "search &#183; full record"),
    ]
    elbow([(scx, 132), (scx, 154)])
    for y, title, sub in families:
        node(scx, y, 300, 52, title, sub)
    # shared services on a dashed rail feeding every family
    node(scx, 372, 300, 52, "LRU cache &#183; parsers &#183; rate limits",
         "XML / JATS / SPL &#183; time-bounded",
         fill=c["accent_soft"], stroke=c["accent"], tcol=c["accent"])
    s.append(
        f'<polyline points="271,398 250,398 250,182" fill="none" stroke="{c["accent"]}" '
        f'stroke-width="1.5" stroke-dasharray="5 4"/>'
    )
    for y, _, _ in families:
        s.append(
            f'<line x1="250" y1="{y + 26}" x2="269" y2="{y + 26}" '
            f'stroke="{c["accent"]}" stroke-width="1.5" stroke-dasharray="5 4" '
            f'marker-end="url(#arr)"/>'
        )

    # ---------------- official APIs ----------------
    panel(636, 52, 308, 400, "OFFICIAL APIS")
    acx = 790
    apis = [
        (88, "NCBI E-utilities", "PubMed &#183; PMC"),
        (148, "Europe PMC", "preprints &#183; patents"),
        (208, "openFDA &#183; DailyMed", "US prescribing info"),
        (268, "UK eMC", "SmPC"),
        (328, "ClinicalTrials.gov v2", "trial records"),
    ]
    for y, title, sub in apis:
        node(acx, y, 280, 48, title, sub)
    s.append(
        f'<text x="654" y="434" font-size="11" font-style="italic" '
        f'fill="{c["muted"]}">no model in this path &#8212; nothing is invented</text>'
    )

    # family -> api fan
    links = [
        (182, 112), (182, 172),      # literature -> NCBI, Europe PMC
        (250, 232), (250, 292),      # labelling -> openFDA, eMC
        (318, 352),                  # trials -> CTgov
    ]
    for fy, ay in links:
        elbow([(573, fy), (618, fy), (618, ay), (648, ay)])

    # ---------------- verifiable return ----------------
    elbow([(790, 376), (790, 478), (56, 478), (56, 260)],
          marker="arr-green", color=c["green"])
    s.append(
        f'<text x="452" y="470" font-size="11" font-weight="600" fill="{c["green"]}" '
        f'text-anchor="middle">every result carries its own identifier &#8212; '
        f'PMID &#183; NCT &#183; DOI</text>'
    )

    s.append("</svg>")
    return "\n".join(s)


os.makedirs("docs", exist_ok=True)
for name, palette in THEMES.items():
    path = f"docs/architecture-{name}.svg"
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(build(palette))
    print("wrote", path)
