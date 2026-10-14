#!/usr/bin/env python3
"""Fetches the title and description of every pull request in an AACR-Bench subset, for `review.intent`.

    evals/aacr/descriptions.py hold82 ctx30        # writes $AACR_DIR/descriptions.json (merged with what is there)

The benchmark's dataset has no pull request text, only its URL; a review in CI gets the text from the CI's
event. This reads it once with `gh api` (public repositories, read-only) and keys it by instance id. The
adapter passes it with `--description-file` when CODE_REVIEWER_DESCRIPTIONS points at the file.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

AACR_DIR = Path(os.environ.get("AACR_DIR", Path.home() / ".cache" / "code-reviewer-aacr"))
BENCH = AACR_DIR / "aacr-bench"
OUT = AACR_DIR / "descriptions.json"


def pr_urls() -> dict[str, str]:
    """Head commit → pull request URL, from the benchmark's dataset."""
    rows = json.loads((BENCH / "dataset" / "positive_samples.json").read_text(encoding="utf-8"))
    return {r["target_commit"]: r["githubPrUrl"] for r in rows}


def fetch(url: str) -> dict[str, str] | None:
    m = re.fullmatch(r"https://github\.com/([^/]+)/([^/]+)/pull/(\d+)", url)
    if not m:
        return None
    owner, repo, number = m.groups()
    res = subprocess.run(
        ["gh", "api", f"repos/{owner}/{repo}/pulls/{number}", "--jq", "{title: .title, body: (.body // \"\")}"],
        capture_output=True,
        text=True,
    )
    if res.returncode != 0:
        print(f"  {url}: {res.stderr.strip()}", file=sys.stderr)
        return None
    return json.loads(res.stdout)


def main(subsets: list[str]) -> None:
    if not subsets:
        sys.exit(__doc__)
    urls = pr_urls()
    known = json.loads(OUT.read_text(encoding="utf-8")) if OUT.is_file() else {}
    for subset in subsets:
        data = BENCH / "evaluation" / "data" / f"aacr_{subset}.jsonl"
        for line in data.read_text(encoding="utf-8").splitlines():
            inst = json.loads(line)
            iid = inst["instance_id"]
            if iid in known:
                continue
            url = urls.get(inst["head_commit"])
            text = fetch(url) if url else None
            if text is None:
                print(f"  {iid}: no description", file=sys.stderr)
                continue
            known[iid] = {"url": url, **text}
            print(f"  {iid}: {text['title'][:70]}")
    OUT.write_text(json.dumps(known, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(known)} descriptions in {OUT}")


if __name__ == "__main__":
    main(sys.argv[1:])
