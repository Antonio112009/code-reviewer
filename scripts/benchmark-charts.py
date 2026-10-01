"""Draws the benchmark charts of BENCHMARKS.md and README.md as static SVGs (a light and a dark version each,
picked by prefers-color-scheme) from the numbers below. Re-run after a measurement round and commit:

    python3 scripts/benchmark-charts.py docs/img

Every number below is cited, with its build, command and judge, in BENCHMARKS.md. Colours are the data-viz
reference palette, validated for colour-vision separation and contrast on GitHub's light (#ffffff) and dark
(#0d1117) surfaces; every mark carries a label or a legend entry, so nothing rests on colour alone.
"""
from __future__ import annotations

import sys

FONT = 'font-family="system-ui, -apple-system, &quot;Segoe UI&quot;, sans-serif"'
THEMES = {
    "light": {"ours": "#2a78d6", "plain": "#eb6834", "other": "#a5a39c", "primary": "#1f2328", "secondary": "#52514e",
              "muted": "#898781", "grid": "#e1e0d9", "axis": "#c3c2b7", "surface": "#ffffff", "iso": "#cfcdc4", "link": "#c3c2b7",
              "set1": "#1baf7a", "set2": "#4a3aa7"},
    "dark": {"ours": "#3987e5", "plain": "#d95926", "other": "#6b6a64", "primary": "#f0f6fc", "secondary": "#c3c2b7",
             "muted": "#898781", "grid": "#2c2c2a", "axis": "#383835", "surface": "#0d1117", "iso": "#3a3a37", "link": "#55554f",
             "set1": "#199e70", "set2": "#9085e9"},
}

# --- Real bugs: Martian Code Review Bench, core profile (158 golden comments), the leaderboard's judge -------------
# Published review tools, Opus 4.5 judge, core profile, as published by Martian at benchmark commit e616e849
# (offline/analysis/benchmark_dashboard.json); "gitar" is left out: it was judged against an older golden set.
PUBLISHED = [  # precision, recall
    (67.1, 64.6), (61.5, 65.8), (59.5, 65.2), (55.4, 62.0), (61.1, 48.7), (53.5, 52.5), (69.1, 41.1), (56.9, 46.8),
    (50.9, 51.3), (45.3, 55.1), (38.5, 66.5), (46.3, 48.1), (41.0, 55.1), (59.2, 38.6), (61.5, 37.3), (32.6, 59.5),
    (40.1, 41.1), (43.2, 38.0), (54.3, 15.8), (100.0, 7.6),
]
# Three of them re-judged from their published candidates by the judge that scored code-reviewer and the plain model
# (`evals/martian/judge.py --baseline <tool>`): (published point, re-judged point), precision and recall.
REJUDGED = [  # label next to the ring: (dx, dy, text-anchor)
    ("#1", (67.1, 64.6), (61.4, 59.5), (0, -11, "middle")),  # Qodo Extended
    ("#3", (59.5, 65.2), (58.1, 63.3), (7, 17, "start")),  # Augment
    ("#12", (46.3, 48.1), (41.8, 41.8), (9, 4, "start")),  # Claude Code CLI
]
REJUDGED_NAMES = "Qodo Extended #1, Augment #3, Claude Code CLI #12"
# code-reviewer 0.7.0 (eb5c564), runs m-1 and m-2 averaged, and the same model asked once (plain LLM), p-1 and
# p-2 averaged; judged by claude-opus-4-5-20251101 through `claude -p` (BENCHMARKS.md, "Judges").
OURS_MAIN = (73.3, 37.3)  # main report
OURS_ALL = (64.0, 54.1)  # main report + "worth a look"
PLAIN = (39.0, 71.5)

# --- The same model with and without the pipeline: per benchmark, its headline, details, cost and metric rows ----
DUMBBELL = [  # (title, details, cost, [(metric, plain value, code-reviewer value)])
    ("Real bugs: Martian Code Review Bench, 50 pull requests",
     "code-reviewer 0.7.0, main report and “worth a look”; two runs each; judged by Claude Opus 4.5",
     "per pull request: $0.08 plain, $0.40 code-reviewer",
     [("Precision", 39.0, 64.0), ("Recall", 71.5, 54.1), ("F1", 50.5, 58.7)]),
    ("Reviewers' comments: AACR-Bench, 82 held-out pull requests",
     "code-reviewer main (0.7.0 + maintainability notes); one run each; matched by Claude Sonnet",
     "per pull request: $0.09 plain, $0.40 code-reviewer",
     [("Precision", 23.5, 31.4), ("Recall", 10.6, 9.0), ("F1", 14.6, 13.9)]),
]

# --- Reviewers' comments: AACR-Bench F1 by configuration, ctx30 (two runs) and held-out (one run) ---------------
AACR_ROWS = [  # label, ctx30 F1, held-out F1 (None = not measured)
    ("0.5.2 + Sonnet critic", 11.7, None),
    ("0.7.0", 12.9, 10.6),
    ("+ maintainability notes", 15.3, 13.9),
    ("+ --deepen, second pass", 19.7, None),
]
AACR_PLAIN = ("same model, one call", 17.6, 14.6)  # the plain baseline, drawn below a rule
AACR_SERIES = ["ctx30, 30 PRs, two runs", "held-out, 82 PRs, one run"]


def text(x: float, y: float, s: str, fill: str, size: float = 12, **attrs: str) -> str:
    extra = "".join(f' {k.replace("_", "-")}="{v}"' for k, v in attrs.items())
    return f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{fill}"{extra}>{s}</text>'


def dot(x: float, y: float, r: float, fill: str, ring: str) -> str:
    return f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{fill}" stroke="{ring}" stroke-width="2"/>'


def bar(x: float, y: float, length: float, height: int, color: str) -> str:
    """A horizontal bar: 4px rounded data end, square at the baseline."""
    r = 4
    if length <= r:
        return f'<rect x="{x}" y="{y}" width="{length:.1f}" height="{height}" fill="{color}"/>'
    return (f'<path d="M{x} {y} H{x + length - r:.1f} a{r} {r} 0 0 1 {r} {r} V{y + height - r} '
            f'a{r} {r} 0 0 1 -{r} {r} H{x} Z" fill="{color}"/>')


def write(out_dir: str, name: str, theme: str, width: int, height: int, label: str, body: list[str]) -> None:
    head = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" '
            f'role="img" aria-label="{label}" {FONT}>')
    with open(f"{out_dir}/{name}-{theme}.svg", "w", encoding="utf-8") as f:
        f.write("\n".join([head, *body, "</svg>"]) + "\n")


def ring(x: float, y: float, r: float, color: str, surface: str) -> str:
    return f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{surface}" stroke="{color}" stroke-width="2"/>'


def positioning(out_dir: str) -> None:
    """Precision against recall on real bugs, with lines of equal F1: where code-reviewer sits."""
    W, H = 760, 698
    X0, X1, Y0, Y1 = 72, 650, 602, 174  # plot area: recall on x, precision on y, both 0–100%
    sx = lambda r: X0 + (X1 - X0) * r / 100  # noqa: E731
    sy = lambda p: Y0 - (Y0 - Y1) * p / 100  # noqa: E731
    (pm, rm), (pa, ra), (pp, rp) = OURS_MAIN, OURS_ALL, PLAIN
    for theme, t in THEMES.items():
        parts = [
            text(16, 28, "Real bugs: precision and recall on Martian's Code Review Bench", t["primary"], 16, font_weight="600"),
            text(16, 50, "50 pull requests, 158 golden comments (core profile), judged by Claude Opus 4.5, the leaderboard's judge model.", t["secondary"]),
            text(16, 67, "Our judging is stricter than the published one: compare code-reviewer with the rings, the same tools re-judged our way.", t["secondary"]),
        ]
        legend = (
            (dot, t["ours"], "code-reviewer 0.7.0 (two runs)"), (dot, t["plain"], "same model, one call (two runs)"),
            (dot, t["other"], "20 published review tools, as published"),
            (ring, t["other"], f"re-judged our way: {REJUDGED_NAMES}"),
        )
        for i, (mark, color, name) in enumerate(legend):
            row = 0 if i < 2 else i - 1  # the first two side by side, then one per row
            lx, ly = 16 + (300 if i == 1 else 0), 96 + row * 22
            parts.append(mark(lx + 6, ly, 5.5 if mark is dot else 4.5, color, t["surface"]))
            parts.append(text(lx + 18, ly + 4, name, t["secondary"]))
        for v in (25, 50, 75, 100):
            parts.append(f'<line x1="{sx(v):.1f}" y1="{Y0}" x2="{sx(v):.1f}" y2="{Y1}" stroke="{t["grid"]}" stroke-width="1"/>')
            parts.append(f'<line x1="{X0}" y1="{sy(v):.1f}" x2="{X1}" y2="{sy(v):.1f}" stroke="{t["grid"]}" stroke-width="1"/>')
        parts.append(f'<line x1="{X0}" y1="{Y0}" x2="{X1}" y2="{Y0}" stroke="{t["axis"]}" stroke-width="1"/>')
        parts.append(f'<line x1="{X0}" y1="{Y0}" x2="{X0}" y2="{Y1}" stroke="{t["axis"]}" stroke-width="1"/>')
        for v in (0, 25, 50, 75, 100):
            parts.append(text(sx(v), Y0 + 18, f"{v}%", t["muted"], 11, text_anchor="middle"))
            parts.append(text(X0 - 8, sy(v) + 4, f"{v}%", t["muted"], 11, text_anchor="end"))
        parts.append(text((X0 + X1) / 2, Y0 + 40, "Recall: share of the known bugs found", t["secondary"], 12, text_anchor="middle"))
        parts.append(f'<text x="24" y="{(Y0 + Y1) / 2:.1f}" font-size="12" fill="{t["secondary"]}" text-anchor="middle" transform="rotate(-90 24 {(Y0 + Y1) / 2:.1f})">Precision: share of findings that match a known bug</text>')
        for f1 in (30, 40, 50, 60, 70):  # lines of equal F1
            r_min = 100 * f1 / (200 - f1)
            pts = []
            for i in range(61):
                r = r_min + (100 - r_min) * i / 60
                pts.append(f"{sx(r):.1f},{sy(f1 * r / (2 * r - f1)):.1f}")
            parts.append(f'<polyline points="{" ".join(pts)}" fill="none" stroke="{t["iso"]}" stroke-width="1"/>')
            parts.append(text(sx(100) + 6, sy(f1 * 100 / (200 - f1)) + 4, f"F1 {f1}", t["muted"], 11))
        for _, (p0, r0), (p1, r1), _ in REJUDGED:
            parts.append(f'<line x1="{sx(r0):.1f}" y1="{sy(p0):.1f}" x2="{sx(r1):.1f}" y2="{sy(p1):.1f}" stroke="{t["other"]}" stroke-width="1.5" stroke-dasharray="3 3"/>')
        for p, r in PUBLISHED:
            parts.append(dot(sx(r), sy(p), 4.5, t["other"], t["surface"]))
        for rank, _, (p1, r1), (dx, dy, anchor) in REJUDGED:
            parts.append(ring(sx(r1), sy(p1), 4.5, t["other"], t["surface"]))
            parts.append(text(sx(r1) + dx, sy(p1) + dy, rank, t["secondary"], 10.5, text_anchor=anchor))
        parts.append(f'<line x1="{sx(rm):.1f}" y1="{sy(pm):.1f}" x2="{sx(ra):.1f}" y2="{sy(pa):.1f}" stroke="{t["ours"]}" stroke-width="2"/>')
        parts.append(dot(sx(rm), sy(pm), 6.5, t["ours"], t["surface"]))
        parts.append(dot(sx(ra), sy(pa), 6.5, t["ours"], t["surface"]))
        parts.append(dot(sx(rp), sy(pp), 6.5, t["plain"], t["surface"]))
        parts.append(text(sx(rm) - 10, sy(pm) - 10, "main report", t["primary"], 12, text_anchor="end", font_weight="600"))
        # the published dots and rings crowd the space next to this point: label it above, with a leader line
        parts.append(f'<line x1="{sx(ra) + 5:.1f}" y1="{sy(pa) - 6:.1f}" x2="{sx(ra) + 16:.1f}" y2="{sy(pa) - 30:.1f}" stroke="{t["ours"]}" stroke-width="1"/>')
        parts.append(text(sx(ra) + 20, sy(pa) - 34, "+ “worth a look”", t["primary"], 12, font_weight="600"))
        parts.append(text(sx(rp) + 10, sy(pp) + 18, "same model, one call", t["primary"], 12))
        parts.append(text(16, H - 30, "Method, judge calibration, builds and commands: BENCHMARKS.md. Published points: Martian's leaderboard", t["muted"], 11))
        parts.append(text(16, H - 14, "(github.com/withmartian/code-review-benchmark, offline/analysis), Opus 4.5 judge, at commit e616e849.", t["muted"], 11))
        label = (f"Precision against recall on real bugs, Martian Code Review Bench, Opus 4.5 judge: code-reviewer 0.7.0 main report "
                 f"{pm} precision {rm} recall, with worth-a-look findings {pa} and {ra}; the same model asked once {pp} and {rp}; "
                 f"20 published tools between {min(p for p, _ in PUBLISHED)} and {max(p for p, _ in PUBLISHED)} precision as published; "
                 f"re-judged our way ({REJUDGED_NAMES}): " + "; ".join(f"{rank} {p0}/{r0} published, {p1}/{r1} re-judged" for rank, (p0, r0), (p1, r1), _ in REJUDGED))
        write(out_dir, "martian-positioning", theme, W, H, label, parts)


def with_and_without(out_dir: str) -> None:
    """The same model with and without the pipeline: per benchmark, precision, recall and F1, plain against code-reviewer."""
    W, X0, SCALE = 760, 120, 5.6  # plot from x=120, 100% = 560px
    HEAD, ROW, GAP, TOP = 44, 28, 22, 104
    group_height = lambda n: HEAD + 10 + ROW * (n - 1) + 26 + GAP - 4  # noqa: E731  (header, rows, axis labels, gap)
    height = TOP + sum(group_height(len(rows)) for *_, rows in DUMBBELL) + 24
    for theme, t in THEMES.items():
        parts = [
            text(16, 28, "The same model, with and without code-reviewer's pipeline", t["primary"], 16, font_weight="600"),
            text(16, 50, "Plain: Claude Sonnet given the pull request's diff in one call. code-reviewer: the same model, same", t["secondary"]),
            text(16, 67, "reasoning effort, with chunking, repository tools, skills, a critic and confidence thresholds.", t["secondary"]),
        ]
        lx = 16
        for color, name in ((t["plain"], "plain, one call"), (t["ours"], "code-reviewer")):
            parts.append(dot(lx + 6, 88, 5.5, color, t["surface"]))
            parts.append(text(lx + 18, 92, name, t["secondary"]))
            lx += 150
        y = TOP
        for title, details, cost, rows in DUMBBELL:
            parts.append(f'<line x1="16" y1="{y}" x2="{W - 16}" y2="{y}" stroke="{t["grid"]}" stroke-width="1"/>')
            parts.append(text(16, y + 20, title, t["primary"], 13, font_weight="600"))
            parts.append(text(16, y + 37, details, t["muted"], 11))
            parts.append(text(W - 16, y + 20, cost, t["secondary"], 11.5, text_anchor="end"))
            top = y + HEAD + 10
            for v in (0, 25, 50, 75, 100):
                gx = X0 + v * SCALE
                parts.append(f'<line x1="{gx:.1f}" y1="{top - 12}" x2="{gx:.1f}" y2="{top + ROW * (len(rows) - 1) + 12}" stroke="{t["grid"] if v else t["axis"]}" stroke-width="1"/>')
            for i, (metric, plain, ours) in enumerate(rows):
                ry = top + i * ROW
                parts.append(text(X0 - 12, ry + 4, metric, t["secondary"], 12, text_anchor="end"))
                a, b = X0 + plain * SCALE, X0 + ours * SCALE
                dy = 4 if abs(a - b) < 12 else 0  # dots closer than their size sit a little apart, so both stay visible
                parts.append(f'<line x1="{a:.1f}" y1="{ry - dy}" x2="{b:.1f}" y2="{ry + dy}" stroke="{t["link"]}" stroke-width="2"/>')
                parts.append(dot(a, ry - dy, 5.5, t["plain"], t["surface"]))
                parts.append(dot(b, ry + dy, 5.5, t["ours"], t["surface"]))
                left, right = (a, b) if plain <= ours else (b, a)
                lv, rv = (plain, ours) if plain <= ours else (ours, plain)
                parts.append(text(left - 10, ry + 4, f"{lv:.1f}", t["secondary"], 11.5, text_anchor="end", font_variant_numeric="tabular-nums"))
                parts.append(text(right + 10, ry + 4, f"{rv:.1f}", t["secondary"], 11.5, font_variant_numeric="tabular-nums"))
            axis_y = top + ROW * (len(rows) - 1) + 26
            for v in (0, 25, 50, 75, 100):
                parts.append(text(X0 + v * SCALE, axis_y, f"{v}%", t["muted"], 10.5, text_anchor="middle"))
            y += group_height(len(rows))
        parts.append(text(16, height - 14, "Builds, commands, judges and per-run numbers: BENCHMARKS.md.", t["muted"], 11))
        label = "The same model with and without code-reviewer's pipeline. " + " ".join(
            f"{title}: " + "; ".join(f"{m} plain {p}, code-reviewer {o}" for m, p, o in rows) + "." for title, _, _, rows in DUMBBELL)
        write(out_dir, "plain-vs-pipeline", theme, W, height, label, parts)


def aacr(out_dir: str) -> None:
    W, LABEL_W, SCALE = 640, 230, 12.0  # 30% = 360px
    BAR, GAP, BAND, TOP = 14, 2, 46, 116
    colors = lambda t: [t["set1"], t["set2"]]  # noqa: E731  (datasets, not code-reviewer / plain)
    rows = [*AACR_ROWS, AACR_PLAIN]
    for theme, t in THEMES.items():
        height = TOP + BAND * len(rows) + 56
        parts = [
            text(16, 26, "AACR-Bench: F1 against human and LLM reviewers' comments, by configuration", t["primary"], 15, font_weight="600"),
            text(16, 46, "Semantic match by a Sonnet judge; every code-reviewer configuration runs with its critic. Two runs per", t["secondary"]),
            text(16, 62, "value on ctx30, one on the held-out pull requests. Last row: the same model given the diff in one call.", t["secondary"]),
        ]
        lx = 16
        for slot, name in enumerate(AACR_SERIES):
            parts.append(f'<rect x="{lx}" y="{TOP - 34}" width="12" height="12" rx="2" fill="{colors(t)[slot]}"/>')
            parts.append(text(lx + 18, TOP - 24, name, t["secondary"]))
            lx += 18 + 7 * len(name) + 24
        for v in (0, 10, 20, 30):
            gx = LABEL_W + v * SCALE
            parts.append(f'<line x1="{gx:.1f}" y1="{TOP - 6}" x2="{gx:.1f}" y2="{TOP + BAND * len(rows) - 10}" stroke="{t["grid"] if v else t["axis"]}" stroke-width="1"/>')
            parts.append(text(gx, TOP + BAND * len(rows) + 6, f"{v}{'% F1' if v == 30 else ''}", t["muted"], 11, text_anchor="middle"))
        for i, (label, a, b) in enumerate(rows):
            y = TOP + i * BAND
            if i == len(AACR_ROWS):  # the plain baseline, for reference
                parts.append(f'<line x1="16" y1="{y - 8}" x2="{W - 16}" y2="{y - 8}" stroke="{t["grid"]}" stroke-width="1"/>')
            parts.append(text(16, y + BAR + 4, label, t["primary"] if i < len(AACR_ROWS) else t["secondary"], 12.5))
            for k, value in enumerate((a, b)):
                yy = y + k * (BAR + GAP)
                if value is None:
                    parts.append(text(LABEL_W + 6, yy + BAR / 2 + 4, "not measured", t["muted"], 11))
                    continue
                parts.append(bar(LABEL_W, yy, value * SCALE, BAR, colors(t)[k]))
                parts.append(text(LABEL_W + value * SCALE + 6, yy + BAR / 2 + 4, f"{value:.1f}", t["secondary"], 12, font_variant_numeric="tabular-nums"))
        ny = TOP + BAND * len(rows) + 32
        parts.append(text(16, ny, "The references are reviewers' comments: 79% written by LLM reviewers, 40% about maintainability.", t["muted"], 11))
        label = "F1 on AACR-Bench by configuration: " + "; ".join(
            f"{r[0]} {r[1]}" + (f" on ctx30 and {r[2]} held out" if r[2] is not None else "") for r in rows)
        write(out_dir, "aacr-progress", theme, W, height, label, parts)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    positioning(sys.argv[1])
    with_and_without(sys.argv[1])
    aacr(sys.argv[1])
    print("charts written to", sys.argv[1])
