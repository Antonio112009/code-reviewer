"""ss-1 without the findings only the security sweep reported: the same chunk reviews, sweep and critic."""
import json, sys, shutil
from pathlib import Path
R = Path.home() / ".cache/code-reviewer-martian/results"
src, dst = R / sys.argv[1], R / sys.argv[2]
dst.mkdir(exist_ok=True)
n = 0
for p in src.glob("*.json"):
    if p.name.startswith("eval"): continue
    d = json.load(open(p))
    if p.name != "provenance.json" and d.get("report"):
        for lst in ("findings", "advisory", "notes"):
            keep = [x for x in d["report"].get(lst) or [] if (x.get("source") or {}).get("chunkIds") != ["security-sweep"]]
            n += len(d["report"].get(lst) or []) - len(keep)
            d["report"][lst] = keep
    json.dump(d, open(dst / p.name, "w"))
print("removed", n, "security-sweep-only findings")
