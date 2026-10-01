"""Draws the benchmark charts of docs/benchmarks.md and README.md as static SVGs (a light and a dark version
each, picked by prefers-color-scheme) from the numbers below. Re-run after a measurement round and commit:

    python3 scripts/benchmark-charts.py docs/img

Colours are the data-viz reference palette, validated for colour-vision separation and contrast on GitHub's
light (#ffffff) and dark (#0d1117) surfaces; every bar carries its value and a row label, so nothing rests on
colour alone. Bars are 14–18px, rounded at the data end and square at the baseline; gridlines are hairlines.
"""
from __future__ import annotations

import sys

FONT = 'font-family="system-ui, -apple-system, &quot;Segoe UI&quot;, sans-serif"'
THEMES = {
    "light": {"series": ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"], "primary": "#1f2328", "secondary": "#52514e",
              "muted": "#898781", "grid": "#e1e0d9", "axis": "#c3c2b7"},
    "dark": {"series": ["#3987e5", "#d95926", "#199e70", "#c98500"], "primary": "#f0f6fc", "secondary": "#c3c2b7",
             "muted": "#898781", "grid": "#2c2c2a", "axis": "#383835"},
}

# Real bugs: Martian Code Review Bench, core profile, two runs of 0.7.0 averaged (evals/martian/README.md).
MARTIAN_ROWS = [  # label, precision, recall, F1, colour slot
    ("code-reviewer, main report", 72.1, 36.7, 48.7, 0),
    ("code-reviewer, + worth a look", 63.2, 53.8, 58.2, 1),
    ("Augment, published candidates", 54.7, 59.5, 57.0, 2),
    ("Claude Code, published candidates", 40.0, 40.5, 40.3, 3),
]
# Reviewers' comments: AACR-Bench F1 by configuration, ctx30 (two runs) and the held-out half (one run).
AACR_ROWS = [  # label, ctx30 F1, held-out F1 (None = not measured)
    ("0.6.0, --full", 11.7, None),
    ("0.7.0 (full is the default)", 12.9, 10.6),
    ("+ maintainability notes", 15.3, 13.9),
    ("+ --deepen, second pass", 19.7, None),
]
AACR_SERIES = ["ctx30, 30 PRs, two runs", "held-out, 82 PRs, one run"]


def bar(x: float, y: float, length: float, height: int, color: str) -> str:
    """A horizontal bar: 4px rounded data end, square at the baseline."""
    r = 4
    if length <= r:
        return f'<rect x="{x}" y="{y}" width="{length:.1f}" height="{height}" fill="{color}"/>'
    return (f'<path d="M{x} {y} H{x + length - r:.1f} a{r} {r} 0 0 1 {r} {r} V{y + height - r} '
            f'a{r} {r} 0 0 1 -{r} {r} H{x} Z" fill="{color}"/>')


def text(x: float, y: float, s: str, fill: str, size: float = 12, **attrs: str) -> str:
    extra = "".join(f' {k.replace("_", "-")}="{v}"' for k, v in attrs.items())
    return f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{fill}"{extra}>{s}</text>'


def write(out_dir: str, name: str, theme: str, width: int, height: int, label: str, body: list[str]) -> None:
    head = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" '
            f'role="img" aria-label="{label}" {FONT}>')
    with open(f"{out_dir}/{name}-{theme}.svg", "w", encoding="utf-8") as f:
        f.write("\n".join([head, *body, "</svg>"]) + "\n")


def martian(out_dir: str) -> None:
    W, LABEL_W, PANEL_W, SCALE = 820, 230, 190, 1.4  # 100% = 140px
    BAR, BAND, TOP = 18, 30, 108
    rows = MARTIAN_ROWS
    for theme, t in THEMES.items():
        height = TOP + BAND * len(rows) + 74
        parts = [
            text(16, 26, "Real bugs: Martian Code Review Bench, 50 pull requests, core profile (158 golden comments)", t["primary"], 15, font_weight="600"),
            text(16, 46, "code-reviewer 0.7.0, two runs averaged. Augment and Claude Code: their published candidates, re-judged.", t["secondary"]),
            text(16, 62, "One judge for every row (Claude Sonnet via claude -p), 2026-10-01.", t["secondary"]),
        ]
        for p, name in enumerate(("Precision", "Recall", "F1")):
            x0 = LABEL_W + p * PANEL_W
            parts.append(text(x0, TOP - 14, name, t["secondary"], 12, font_weight="600"))
            for v in (0, 50, 100):
                gx = x0 + v * SCALE
                parts.append(f'<line x1="{gx:.1f}" y1="{TOP - 4}" x2="{gx:.1f}" y2="{TOP + BAND * len(rows) - 6}" stroke="{t["grid"] if v else t["axis"]}" stroke-width="1"/>')
                parts.append(text(gx, TOP + BAND * len(rows) + 10, f"{v}{'%' if v == 100 else ''}", t["muted"], 11, text_anchor="middle", font_variant_numeric="tabular-nums"))
        for i, (label, pr, rc, f1, slot) in enumerate(rows):
            y = TOP + i * BAND
            color = t["series"][slot]
            parts.append(f'<circle cx="24" cy="{y + BAR / 2:.1f}" r="4" fill="{color}"/>')
            parts.append(text(36, y + BAR / 2 + 4, label, t["primary"], 12.5))
            for p, value in enumerate((pr, rc, f1)):
                x0 = LABEL_W + p * PANEL_W
                parts.append(bar(x0, y, value * SCALE, BAR, color))
                parts.append(text(x0 + value * SCALE + 6, y + BAR / 2 + 4, f"{value:.1f}", t["secondary"], 12, font_variant_numeric="tabular-nums"))
        ny = TOP + BAND * len(rows) + 34
        parts.append(text(16, ny, "This judge is stricter than the leaderboard's: the same Claude Code candidates score 40.3 F1 here and 47.2 there (Opus 4.5 judge), Augment 57.0 and 62.2.", t["muted"], 11))
        parts.append(text(16, ny + 16, "Method, per-run numbers and caveats: evals/martian/README.md", t["muted"], 11))
        label = ("Precision, recall and F1 on Martian's Code Review Bench: " + "; ".join(
            f"{r[0]} {r[1]}, {r[2]}, {r[3]}" for r in rows))
        write(out_dir, "martian-bench", theme, W, height, label, parts)


def aacr(out_dir: str) -> None:
    W, LABEL_W, SCALE = 640, 230, 12.0  # 30% = 360px
    BAR, GAP, BAND, TOP = 14, 2, 46, 116
    rows = AACR_ROWS
    for theme, t in THEMES.items():
        height = TOP + BAND * len(rows) + 56
        parts = [
            text(16, 26, "AACR-Bench: F1 against human and LLM reviewers' comments, by configuration", t["primary"], 15, font_weight="600"),
            text(16, 46, "Semantic match by a Sonnet judge; every configuration runs with its critic.", t["secondary"]),
            text(16, 62, "Two runs per value on ctx30, one on the held-out pull requests.", t["secondary"]),
        ]
        lx = 16
        for slot, name in enumerate(AACR_SERIES):
            parts.append(f'<rect x="{lx}" y="{TOP - 34}" width="12" height="12" rx="2" fill="{t["series"][slot]}"/>')
            parts.append(text(lx + 18, TOP - 24, name, t["secondary"]))
            lx += 18 + 7 * len(name) + 24
        for v in (0, 10, 20, 30):
            gx = LABEL_W + v * SCALE
            parts.append(f'<line x1="{gx:.1f}" y1="{TOP - 6}" x2="{gx:.1f}" y2="{TOP + BAND * len(rows) - 10}" stroke="{t["grid"] if v else t["axis"]}" stroke-width="1"/>')
            parts.append(text(gx, TOP + BAND * len(rows) + 6, f"{v}{'% F1' if v == 30 else ''}", t["muted"], 11, text_anchor="middle"))
        for i, (label, a, b) in enumerate(rows):
            y = TOP + i * BAND
            parts.append(text(16, y + BAR + 4, label, t["primary"], 12.5))
            for k, value in enumerate((a, b)):
                yy = y + k * (BAR + GAP)
                if value is None:
                    parts.append(text(LABEL_W + 6, yy + BAR / 2 + 4, "not measured", t["muted"], 11))
                    continue
                parts.append(bar(LABEL_W, yy, value * SCALE, BAR, t["series"][k]))
                parts.append(text(LABEL_W + value * SCALE + 6, yy + BAR / 2 + 4, f"{value:.1f}", t["secondary"], 12, font_variant_numeric="tabular-nums"))
        ny = TOP + BAND * len(rows) + 32
        parts.append(text(16, ny, "The benchmark rewards agreement with reviewers' comments, 40% of them about maintainability; see evals/aacr/README.md.", t["muted"], 11))
        label = "F1 on AACR-Bench by configuration: " + "; ".join(
            f"{r[0]} {r[1]}" + (f" on ctx30 and {r[2]} held out" if r[2] is not None else "") for r in rows)
        write(out_dir, "aacr-progress", theme, W, height, label, parts)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    martian(sys.argv[1])
    aacr(sys.argv[1])
    print("charts written to", sys.argv[1])
