#!/usr/bin/env python3
"""Build Ralph-TUI PRD files from compact sources, and validate them.

    python3 ralph/build_prds.py            # build every ralph/src/prd-*.json -> ralph/prd-*.json, then validate
    python3 ralph/build_prds.py --check    # validate only (no writes); exit 1 on any error
    python3 ralph/build_prds.py src/prd-s03-director.json   # one file

Why a build step: the guardrails and quality gates must be identical in every PRD, and every story's
acceptance criteria must end with them (ralph-tui-create-json convention). Authors write only the
story-specific part; this script adds the rest, assigns priorities and enforces the story rules.
Standard library only.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "src"

UNIVERSAL_GATES = [
    "`npm run typecheck` passes",
    "`npm test` passes (offline, no network)",
    "`npm run lint` passes",
]
BROWSER_GATE = (
    "Verify in the browser (dev-browser skill or preview): `npm run dev`, open the page named in the story, "
    "confirm the stated behaviour, and record what you saw in `notes`"
)

STANDARD_GUARDRAILS = [
    "Work offline. Tests use recorded fixtures and DIRECTOR_REPLAY=1. Never call Meta, Clippy, Ollama or any other network service from a story, a test or a script you run during a story. The only network use allowed is `npm install`.",
    "Never commit, push, tag, publish to npm, deploy or change repository settings. autoCommit is off and the owner commits.",
    "Never edit anything under node_modules/. The engine `reacthub-pixitweenjs` is a dependency: if it lacks something, add a row to ENGINE-NEEDS.md (what, where, proposed API, workaround, story) and use a workaround or set notes to 'blocked: engine'.",
    "Edit only the files named in the story's steps, plus their tests. Files under shared/ are contracts (specs/hackathon/meta/06-contracts.md): change them only in a story that says so.",
    "Never put keys, tokens, cookies or personal data in code, fixtures, logs or docs. Fixtures are redacted: no Authorization headers and no data: URLs longer than 200 characters.",
    "No real brand names, logos or real people's likeness in prompts, fixtures or assets.",
    "Record only real results. Never invent measurements, latencies, prices or test output.",
    "Do not add a dependency that the story or 06-contracts.md does not name. If one is truly needed, say why in notes.",
    "Debug output goes to debug/<step>/iteration-NN/ (gitignored). Only curated, redacted fixtures are committed, under fixtures/<step>/.",
    "A step that would call a paid or live API is written as a script that prints an estimate and exits unless `--yes` is passed (`npm run live -- <step> --yes`, one file per step under scripts/live/). Create such scripts; never run them.",
]

STANDING_RULE = (
    "Offline-only PRD. Every story is implementable and verifiable with unit tests, recorded fixtures and the "
    "browser preview; nothing here spends money or needs network. Live and paid checks are listed in "
    "metadata.manualGates and run by the owner."
)

VAGUE = re.compile(r"(works? correctly|handles? edge cases|good ux|user[- ]friendly|as expected\b|properly\b|robust(ly)?\b)", re.I)
LIVE_RUN = re.compile(r"(?i)\b(run|execute|invoke|call)\b[^.;\n]{0,60}(npm run live|api\.meta\.ai|ollama|animate_image)")
CURL = re.compile(r"(?i)\bcurl\s+https?://")

errors: list[str] = []
warnings: list[str] = []


def err(f: str, msg: str) -> None:
    errors.append(f"{f}: {msg}")


def warn(f: str, msg: str) -> None:
    warnings.append(f"{f}: {msg}")


def build(src_path: Path) -> dict | None:
    f = src_path.name
    try:
        src = json.loads(src_path.read_text())
    except Exception as e:  # noqa: BLE001
        err(f, f"invalid JSON: {e}")
        return None

    for key in ("name", "branchName", "description", "metadata", "stories"):
        if key not in src:
            err(f, f"missing key '{key}'")
    if errors and any(e.startswith(f + ": missing") for e in errors):
        return None
    if not str(src["branchName"]).startswith("ralph/"):
        err(f, "branchName must start with 'ralph/'")

    md = src["metadata"]
    for key in ("specs", "readFirst", "requires", "owns", "manualGates"):
        if not isinstance(md.get(key), list):
            err(f, f"metadata.{key} must be a list")
    if not md.get("specs"):
        err(f, "metadata.specs must not be empty")
    if not md.get("readFirst"):
        err(f, "metadata.readFirst must not be empty")
    if not md.get("owns"):
        err(f, "metadata.owns must list the paths this PRD owns")

    stories_out = []
    seen: dict[str, int] = {}
    for i, st in enumerate(src["stories"], start=1):
        sid = st.get("id", "")
        where = f"{sid or 'story#' + str(i)}"
        if not re.fullmatch(r"US-\d{3}", sid):
            err(f, f"{where}: id must look like US-001")
        if sid in seen:
            err(f, f"{where}: duplicate id")
        seen[sid] = i
        title = st.get("title", "")
        if not title or len(title) > 90:
            err(f, f"{where}: title required and <= 90 chars")
        if not str(st.get("description", "")).startswith("As a"):
            err(f, f"{where}: description must start with 'As a'")
        steps = st.get("steps") or []
        if len(steps) < 2 or not all(isinstance(s, str) and len(s) > 10 for s in steps):
            err(f, f"{where}: needs >= 2 concrete steps")
        if len(steps) > 12:
            err(f, f"{where}: {len(steps)} steps is too big for one iteration (max 12); split it")
        if steps and not steps[0].lower().startswith("read"):
            warn(f, f"{where}: first step should be a 'Read ...' step (files and docs to read first)")
        acc = st.get("acceptance") or []
        if len(acc) < 2 or not all(isinstance(a, str) and len(a) >= 12 for a in acc):
            err(f, f"{where}: needs >= 2 verifiable acceptance criteria of its own")
        for a in acc:
            if VAGUE.search(a):
                err(f, f"{where}: vague acceptance criterion: {a!r}")
        labels = st.get("labels") or []
        if not labels:
            err(f, f"{where}: labels required")
        text_len = sum(len(s) for s in steps) + sum(len(a) for a in acc) + len(st.get("description", ""))
        if text_len > 7000:
            err(f, f"{where}: story text is {text_len} chars; too big for one iteration")
        elif text_len > 4500:
            warn(f, f"{where}: story text is {text_len} chars; consider splitting")
        for s in steps:
            if LIVE_RUN.search(s) and not re.match(r"(?i)\s*(create|write|add|implement|document)", s):
                err(f, f"{where}: a step appears to run a live/paid call: {s[:80]!r}")
            if CURL.search(s):
                err(f, f"{where}: curl against a URL is a network call; not allowed in a story")
        deps = st.get("dependsOn", [])
        for d in deps:
            if d not in seen or seen[d] >= i:
                err(f, f"{where}: dependsOn '{d}' must be an earlier story in this file")

        criteria = list(acc) + UNIVERSAL_GATES
        if "ui" in labels:
            criteria.append(BROWSER_GATE)
        stories_out.append(
            {
                "id": sid,
                "title": title,
                "description": st.get("description", ""),
                "steps": steps,
                "acceptanceCriteria": criteria,
                "priority": i,
                "passes": False,
                "notes": st.get("notes", ""),
                "dependsOn": deps,
                "labels": labels,
            }
        )

    if not stories_out:
        err(f, "no stories")
    if len(stories_out) > 40:
        warn(f, f"{len(stories_out)} stories; consider splitting the PRD")

    return {
        "name": src["name"],
        "branchName": src["branchName"],
        "description": src["description"],
        "userStories": stories_out,
        "metadata": {
            "specs": md.get("specs", []),
            "readFirst": md.get("readFirst", []),
            "requires": md.get("requires", []),
            "owns": md.get("owns", []),
            "sharedEdits": md.get("sharedEdits", []),
            "standingRule": STANDING_RULE,
            "guardrails": STANDARD_GUARDRAILS + md.get("extraGuardrails", []),
            "qualityGates": {"universal": UNIVERSAL_GATES, "ui": [BROWSER_GATE]},
            "manualGates": md.get("manualGates", []),
        },
    }


def write_view(stem: str, prd: dict) -> None:
    """Human-readable task view of a built PRD -> ralph/views/<stem>.md (generated; never hand-edit)."""
    views = HERE / "views"
    views.mkdir(exist_ok=True)
    md = prd["metadata"]
    lines = [
        f"# {prd['name']}",
        "",
        "> Generated by `ralph/build_prds.py` from `ralph/src/" + stem + ".json`. Do not edit; edit the source and rebuild.",
        "",
        f"- Branch: `{prd['branchName']}`",
        f"- Requires (merged first): {', '.join(md['requires']) or 'nothing'}",
        f"- Owns: {', '.join('`' + o + '`' for o in md['owns'])}",
        f"- Stories: {len(prd['userStories'])}",
        "",
        prd["description"],
        "",
        "## Manual gates (owner; Ralph never runs these)",
        "",
    ]
    lines += [f"- {g}" for g in md["manualGates"]] or ["- none"]
    lines += ["", "## Stories", "", "| ID | Title | Depends on | Labels |", "|----|-------|------------|--------|"]
    for st in prd["userStories"]:
        lines.append(f"| {st['id']} | {st['title']} | {', '.join(st['dependsOn']) or '-'} | {', '.join(st['labels'])} |")
    for st in prd["userStories"]:
        lines += ["", f"### {st['id']}: {st['title']}", "", st["description"], "", "**Steps**", ""]
        lines += [f"{i}. {x}" for i, x in enumerate(st["steps"], 1)]
        lines += ["", "**Acceptance criteria**", ""]
        lines += [f"- [ ] {x}" for x in st["acceptanceCriteria"]]
    (views / f"{stem}.md").write_text("\n".join(lines) + "\n")


def main(argv: list[str]) -> int:
    check_only = "--check" in argv
    files = [Path(a) for a in argv if not a.startswith("--")]
    if not files:
        files = sorted(SRC.glob("prd-*.json"))
    if not files:
        print("no ralph/src/prd-*.json found")
        return 1

    built: dict[str, dict] = {}
    for sp in files:
        sp = sp if sp.is_absolute() else (HERE / sp if (HERE / sp).exists() else Path.cwd() / sp)
        out = build(sp)
        if out is not None:
            built[sp.name] = out
            if not check_only:
                (HERE / sp.name).write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
                write_view(sp.stem, out)

    # Cross-PRD checks: no two PRDs own the same path; `requires` must name an existing PRD.
    owners: dict[str, str] = {}
    stems = {p.stem for p in SRC.glob("prd-*.json")}
    for fname, prd in built.items():
        for path in prd["metadata"]["owns"]:
            if path in owners and owners[path] != fname:
                err(fname, f"owns '{path}', which {owners[path]} also owns")
            owners[path] = fname
        for req in prd["metadata"]["requires"]:
            if req not in stems:
                warn(fname, f"requires '{req}', which has no source file yet")

    # sharedEdits: a PRD may make a small, named edit to a file another PRD owns (for example S8b appends a middleware to S2's list).
    for fname, prd in built.items():
        for path in prd["metadata"].get("sharedEdits", []):
            if path not in owners:
                warn(fname, f"sharedEdits '{path}' is not owned by any built PRD")
            elif owners[path] == fname:
                err(fname, f"sharedEdits '{path}' is already in this PRD's owns")

    print(f"{'PRD':34} {'stories':>7}  {'ui':>3}  requires")
    total = 0
    for fname, prd in built.items():
        n = len(prd["userStories"])
        total += n
        ui = sum(1 for s in prd["userStories"] if "ui" in s["labels"])
        print(f"{fname:34} {n:7}  {ui:3}  {', '.join(prd['metadata']['requires']) or '-'}")
    print(f"{'TOTAL':34} {total:7}")
    for w in warnings:
        print("WARN ", w)
    for e in errors:
        print("ERROR", e)
    if errors:
        print(f"\n{len(errors)} error(s)")
        return 1
    print("\nOK" + (" (check only)" if check_only else " (built)"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
