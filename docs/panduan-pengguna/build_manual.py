#!/usr/bin/env python3
"""Build branded HTML (and optionally PDF) from PANDUAN_PENGGUNA.md."""
from __future__ import annotations

import html
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MD_PATH = ROOT / "PANDUAN_PENGGUNA.md"
HTML_PATH = ROOT / "manual.html"
PDF_PATH = ROOT.parent / "Panduan_Pengguna_Inspeksi_DT.pdf"
CSS_PATH = ROOT / "print.css"
LOGO = "images/brand/logo.png"


def inline(text: str) -> str:
    text = html.escape(text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"\*(.+?)\*", r"<em>\1</em>", text)
    text = re.sub(r"`(.+?)`", r"<code>\1</code>", text)
    return text


def convert_md(md: str) -> str:
    lines = md.splitlines()
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("```"):
            fence = [""]
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                fence.append(html.escape(lines[i]))
                i += 1
            out.append("<pre><code>" + "\n".join(fence).strip() + "</code></pre>")
            i += 1
            continue
        if re.match(r"^## ", line):
            out.append(f"<h2>{inline(line[3:])}</h2>")
            i += 1
            continue
        if re.match(r"^### ", line):
            out.append(f"<h3>{inline(line[4:])}</h3>")
            i += 1
            continue
        if re.match(r"^#### ", line):
            out.append(f"<h4>{inline(line[5:])}</h4>")
            i += 1
            continue
        if line.startswith("| ") and i + 1 < len(lines) and re.match(r"^\|?\s*-+", lines[i + 1]):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                rows.append([c.strip() for c in lines[i].strip("|").split("|")])
                i += 1
            header, body = rows[0], rows[2:]
            thead = "<thead><tr>" + "".join(f"<th>{inline(c)}</th>" for c in header) + "</tr></thead>"
            tbody = "<tbody>" + "".join(
                "<tr>" + "".join(f"<td>{inline(c)}</td>" for c in row) + "</tr>" for row in body
            ) + "</tbody>"
            out.append(f"<table>{thead}{tbody}</table>")
            continue
        if line.startswith("![") and "](" in line:
            alt, src = re.match(r"!\[(.*?)\]\((.*?)\)", line).groups()
            cap = ""
            j = i + 1
            while j < len(lines) and not lines[j].strip():
                j += 1
            if j < len(lines) and lines[j].startswith("*") and lines[j].endswith("*"):
                cap = inline(lines[j].strip("*"))
                i = j
            fig = f'<figure><img class="shot" src="{html.escape(src)}" alt="{html.escape(alt)}" />'
            if cap:
                fig += f'<figcaption class="caption">{cap}</figcaption>'
            out.append(fig + "</figure>")
            i += 1
            continue
        if line.startswith("- "):
            items = []
            while i < len(lines) and lines[i].startswith("- "):
                items.append(f"<li>{inline(lines[i][2:])}</li>")
                i += 1
            out.append("<ul>" + "".join(items) + "</ul>")
            continue
        if re.match(r"^\d+\. ", line):
            items = []
            while i < len(lines) and re.match(r"^\d+\. ", lines[i]):
                items.append(f"<li>{inline(re.sub(r'^\d+\. ', '', lines[i]))}</li>")
                i += 1
            out.append("<ol>" + "".join(items) + "</ol>")
            continue
        if line.strip() == "---":
            out.append("<hr />")
            i += 1
            continue
        if not line.strip():
            i += 1
            continue
        para = [line]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#{2,}|[-|]|\d+\. |```|---)", lines[i]):
            para.append(lines[i])
            i += 1
        out.append("<p>" + inline(" ".join(para)) + "</p>")
    return "\n".join(out)


TEMPLATE = """<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <title>Panduan Pengguna — Inspeksi DT</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Roboto:ital,wght@0,400;0,500;0,700;1,400&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="print.css" />
</head>
<body>
  <section class="cover">
    <div class="cover-dots" aria-hidden="true">
      {dots}
    </div>
    <div class="logo-plate">
      <img src="{logo}" alt="Inline Technology International" />
    </div>
    <p class="cover-kicker">Dokumentasi produk</p>
    <h1 class="cover-title">Panduan Pengguna</h1>
    <p class="cover-product">Inspeksi DT</p>
    <hr class="cover-rule" />
    <p class="cover-meta">
      Inline Technology International<br />
      Inspeksi harian chassis dump truck<br />
      16 September 2026
    </p>
  </section>

  <header class="sheet-head">
    <img src="{logo}" alt="Inline Technology International" />
    <p class="kicker">Panduan Pengguna · Inspeksi DT</p>
  </header>

  <nav class="toc">
    <h1>Daftar isi</h1>
    <ol>
      {toc}
    </ol>
  </nav>

  <main class="content">
    {body}
  </main>
</body>
</html>
"""


def strip_front_matter(md: str) -> str:
    # Drop the document title block; the cover already states it.
    md = re.sub(r"^# Panduan Pengguna — Inspeksi DT\n\n.*?\n---\n+", "", md, count=1, flags=re.S)
    return md


def enhance_headings(html_body: str) -> str:
    n = {"h2": 0}

    def h2(m: re.Match[str]) -> str:
        inner = m.group(1)
        if inner.startswith("Cara memakai"):
            return '<h2 id="cara-pakai">Cara memakai dokumen ini</h2>'
        if inner.startswith("Lampiran"):
            slug = re.sub(r"[^a-z0-9]+", "-", inner.lower()).strip("-")
            return f'<h2 id="{slug}">{inner}</h2>'
        n["h2"] += 1
        inner = re.sub(r"^\d+\.\s+", "", inner)
        return f'<h2 id="bab-{n["h2"]}"><span class="chap">{n["h2"]:02d}</span>{inner}</h2>'

    html_body = re.sub(r"<h2>(.*?)</h2>", h2, html_body)
    return html_body


def style_figures(html_body: str) -> str:
    return html_body


def wrap_howto(html_body: str) -> str:
    html_body = re.sub(
        r'(<h2 id="cara-pakai">Cara memakai dokumen ini</h2>)(.*?)(?=<h2)',
        lambda m: m.group(1) + f'<div class="callout">{m.group(2).replace("<hr />", "")}</div>',
        html_body,
        count=1,
        flags=re.S,
    )
    return html_body


def build_toc(html_body: str) -> tuple[str, str]:
    items = []
    if 'id="cara-pakai"' in html_body:
        items.append(
            '<li><span class="num"></span><a href="#cara-pakai">Cara memakai dokumen ini</a></li>'
        )
    for m in re.finditer(r'<h2 id="([^"]+)"><span class="chap">(\d+)</span>(.*?)</h2>', html_body):
        items.append(
            f'<li><span class="num">{m.group(2)}</span>'
            f'<a href="#{m.group(1)}">{m.group(3)}</a></li>'
        )
    for m in re.finditer(r'<h2 id="(lampiran-[^"]+)">(.*?)</h2>', html_body):
        items.append(
            f'<li><span class="num"></span><a href="#{m.group(1)}">{m.group(2)}</a></li>'
        )
    return "\n      ".join(items), html_body


def find_chrome() -> str | None:
    candidates = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "google-chrome",
        "chromium",
        "chrome",
    ]
    for c in candidates:
        p = Path(c)
        if p.exists():
            return str(p)
        from shutil import which

        found = which(c)
        if found:
            return found
    return None


def write_html() -> None:
    raw = MD_PATH.read_text(encoding="utf-8")
    md = strip_front_matter(raw)
    body = convert_md(md)
    body = enhance_headings(body)
    body = style_figures(body)
    body = wrap_howto(body)
    toc, body = build_toc(body)
    dots = "\n      ".join("<span></span>" for _ in range(9))
    HTML_PATH.write_text(
        TEMPLATE.format(dots=dots, logo=LOGO, toc=toc, body=body),
        encoding="utf-8",
    )
    print(f"Wrote {HTML_PATH}")


def write_pdf() -> None:
    chrome = find_chrome()
    if not chrome:
        print("Chrome/Chromium not found; HTML is ready at", HTML_PATH)
        return
    cmd = [
        chrome,
        "--headless=new",
        "--disable-gpu",
        "--no-pdf-header-footer",
        "--virtual-time-budget=15000",
        f"--print-to-pdf={PDF_PATH}",
        str(HTML_PATH.resolve().as_uri()),
    ]
    subprocess.check_call(cmd)
    print(f"Wrote {PDF_PATH}")


if __name__ == "__main__":
    write_html()
    if "--html-only" not in sys.argv:
        write_pdf()
