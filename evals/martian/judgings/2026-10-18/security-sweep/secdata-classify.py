"""Security/data golden comments (core) per run: matched where (main/advisory/notes), or missed — and then
judged against the run's rejected findings (critic, below-threshold, ...) with the same Opus 4.5 judge."""
import json, os, sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))  # evals/martian
import judge
R = Path(os.path.expanduser("~/.cache/code-reviewer-martian/results"))
CATS = {"security", "data"}
# secdata-classify.py <out.json> <run-id>...
RUNS = sys.argv[2:] or ["r12-1", "r12-2", "r12-deep", "p-1", "p-2"]
def evals(run):
    p = R/run/"eval-claude-opus-4-5-20251101-nothink-all.json"
    return json.load(open(p if p.exists() else R/run/"eval-claude-opus-4-5-20251101-nothink-main.json"))["evaluations"]
def reports(run):
    out = {}
    for p in (R/run).glob("*.json"):
        if p.name.startswith("eval") or p.name == "provenance.json": continue
        d = json.load(open(p)); out[d["url"]] = d.get("report") or {}
    return out
def text(x): return "\n".join(p for p in [(x.get("title") or "").strip(), (x.get("description") or "").strip()] if p)
def where(report, cand):
    for lst in ("findings", "advisory", "notes"):
        for x in report.get(lst) or []:
            if text(x) == cand: return lst, x
    return None, None
template, judge.SYSTEM = judge.judge_prompts()
pool = ThreadPoolExecutor(8)
golden = {}
out = []
for run in RUNS:
    ev = evals(run); rep = reports(run)
    for url, pr in ev.items():
        e = pr[next(iter(pr))]
        for tp in e["true_positives"]:
            if tp["category"] not in CATS: continue
            lst, x = where(rep.get(url, {}), tp["matched_candidate"])
            out.append({"run": run, "url": url, "golden": tp["golden_comment"], "category": tp["category"], "severity": tp["severity"],
                        "status": f"found:{lst}", "finding": x and {k: x.get(k) for k in ("title", "severity", "confidence", "category")} | {"verdict": (x.get("critique") or {}).get("verdict"), "sweep": "sweep" in ((x.get("source") or {}).get("chunkIds") or [])}})
        for g in e["false_negatives"]:
            if g["category"] not in CATS: continue
            rej = [x for x in rep.get(url, {}).get("rejected") or [] if x.get("title")]
            vs = list(pool.map(lambda x: judge.ask(template.format(golden_comment=g["golden_comment"], candidate=text(x)), "claude-opus-4-5-20251101", "", False), rej))
            best = None
            for x, v in zip(rej, vs):
                if v.get("match") and (best is None or v["confidence"] > best[1]["confidence"]): best = (x, v)
            out.append({"run": run, "url": url, "golden": g["golden_comment"], "category": g["category"], "severity": g["severity"],
                        "status": "lost:" + (best[0].get("droppedReason") or "?") if best else "never-reported",
                        "finding": best and {k: best[0].get(k) for k in ("title", "severity", "confidence", "category", "origin")} | {"critique": best[0].get("critique"), "sweep": "sweep" in ((best[0].get("source") or {}).get("chunkIds") or [])}})
json.dump(out, open(sys.argv[1], "w"), indent=1)
