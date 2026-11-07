#!/usr/bin/env python3
"""Normalize Sumana's bundled Latin metrics without changing its letterforms.

Run from any directory: python scripts/normalize-bible-fonts.py
Requires: python -m pip install fonttools brotli

The upstream Latin subsets retain the much taller Devanagari metrics. Safari
uses those metrics for inline backgrounds and native selection, so a background
can cover text on the next line even with an explicit CSS line-height. Normalize
the font tables so the fix also works in Safari without CSS metric overrides.

The bundled Sumana-OFL.txt permits modification and declares no Reserved Font
Name. Keep its license, copyright, outlines, advances, and positioning tables.
"""

from hashlib import sha256
from pathlib import Path
import json

from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont


FONT_DIR = Path(__file__).resolve().parents[1] / "biblia" / "fonts"
ASCENT = 1000
DESCENT = -300
LINE_GAP = 0


def normalize(path):
    original_hash = sha256(path.read_bytes()).hexdigest()
    font = TTFont(path, recalcTimestamp=False)
    if font["head"].unitsPerEm != 1000:
        raise ValueError(f"Unexpected units per em in {path.name}")

    # Check all glyphs, including unencoded ligatures and Latin-ext accents.
    glyphs = font.getGlyphSet()
    for name in glyphs.keys():
        pen = BoundsPen(glyphs)
        glyphs[name].draw(pen)
        if pen.bounds and (pen.bounds[1] < DESCENT or pen.bounds[3] > ASCENT):
            raise ValueError(f"Metrics would clip {path.name}: {name}")

    # Only vertical metrics and the font checksum may change on serialization.
    stable = {
        tag: font.getTableData(tag)
        for tag in font.keys()
        if tag not in {"GlyphOrder", "head", "hhea", "OS/2"}
    }
    before = {
        "ascent": font["hhea"].ascent,
        "descent": font["hhea"].descent,
        "lineGap": font["hhea"].lineGap,
    }
    font["hhea"].ascent = font["OS/2"].sTypoAscender = ASCENT
    font["hhea"].descent = font["OS/2"].sTypoDescender = DESCENT
    font["hhea"].lineGap = font["OS/2"].sTypoLineGap = LINE_GAP
    font["OS/2"].usWinAscent = ASCENT
    font["OS/2"].usWinDescent = -DESCENT
    font.save(path)

    check = TTFont(path, recalcTimestamp=False)
    for tag, data in stable.items():
        if check.getTableData(tag) != data:
            raise ValueError(f"Unexpected change to {tag} in {path.name}")
    return original_hash, before


def main():
    sources_path = FONT_DIR / "SOURCES.json"
    sources = json.loads(sources_path.read_text())
    for source in sources:
        if source["family"] != "Sumana":
            continue
        original_hash, before = normalize(FONT_DIR / source["file"])
        # Preserve the original provenance when this script is run again.
        source.setdefault("upstreamSha256", original_hash)
        source.setdefault("upstreamMetrics", before)
        source["license"] = "SIL Open Font License 1.1; see Sumana-OFL.txt"
        source["localModification"] = {
            "description": "Normalized Latin vertical metrics; letterforms, advances and positioning unchanged.",
            "script": "scripts/normalize-bible-fonts.py",
            "unitsPerEm": 1000,
            "ascent": ASCENT,
            "descent": DESCENT,
            "lineGap": LINE_GAP,
        }
        print(f"{source['file']}: verified unchanged glyphs and positioning")
    sources_path.write_text(json.dumps(sources, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
