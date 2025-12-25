
import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path

from whatsapp_scoring import analyze_members, extract_system_participants_from_files, parse_whatsapp_export_files


OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "xiaomi/mimo-v2-flash:free")
ALLOWED_BADGES = [
    "MVP",
    "Helper",
    "Curator",
    "Deep Writer",
    "Regular",
    "Comedian",
    "Media Mogul",
    "Echo Chamber",
]
ALLOWED_ROLES = [
    "Ghost",
    "Problem Solver",
    "Curator",
    "Comedian",
    "Asker",
    "Deep Writer",
    "Shadow Watcher",
]


def _default_output_path() -> str:
    if os.path.exists("web"):
        return "web/public/data/members.json"
    if os.path.exists("public"):
        return "public/data/members.json"
    return "data/members.json"


def _expand_inputs(inputs: list[str]) -> list[Path]:
    expanded: list[Path] = []
    for item in inputs:
        p = Path(item)
        if any(ch in item for ch in ["*", "?", "["]):
            expanded.extend(Path(".").glob(item))
        elif p.is_dir():
            expanded.extend(sorted(p.rglob("*.txt")))
        else:
            expanded.append(p)

    unique = []
    seen = set()
    for p in expanded:
        rp = p.resolve()
        if rp in seen:
            continue
        seen.add(rp)
        unique.append(p)
    return unique


def _llm_enrich_member(member: dict, *, timeout_s: int = 60) -> dict:
    if not OPENROUTER_API_KEY:
        return member

    heuristic_role = member.get("analysis", {}).get("role", "Shadow Watcher")
    sample = member.get("samples") or []
    msgs_text = "\n".join(sample[-40:])
    stats = member.get("stats") or {}
    signals = member.get("signals") or {}
    prompt = (
        "You are scoring a WhatsApp group member using both metrics and message samples.\n\n"
        f'User: "{member.get("name")}"\n\n'
        "Metrics (JSON):\n"
        f"{json.dumps({'stats': stats, 'signals': signals}, ensure_ascii=False)}\n\n"
        "Messages (recent):\n"
        f"{msgs_text}\n\n"
        "Task:\n"
        "1) Assign a Value Score (1-10) based on helpfulness, insight, and community-building (not volume).\n"
        "2) Assign a short Role label from this list ONLY:\n"
        f"{', '.join(ALLOWED_ROLES)}\n"
        "Pick the best fit. Use Shadow Watcher only if there is no strong signal for any role.\n"
        "3) Write a 1-sentence Vibe.\n"
        "4) Choose 0-5 badges from this allowed list only:\n"
        f"{', '.join(ALLOWED_BADGES)}\n\n"
        "Badge guidance:\n"
        "- MVP: consistently high value\n"
        "- Helper: answers questions / fixes issues\n"
        "- Curator: shares useful links/resources\n"
        "- Deep Writer: long, thoughtful messages\n"
        "- Regular: active across many days\n"
        "- Comedian: humor / lightens chat\n"
        "- Media Mogul: shares lots of media\n"
        "- Echo Chamber: repetitive/duplicate messages\n\n"
        "Output JSON only:\n"
        '{ "value_score": <number>, "role": "<string>", "vibe": "<string>", "badges": ["<badge>", ...] }'
    )

    body = json.dumps(
        {
            "model": OPENROUTER_MODEL,
            "messages": [{"role": "user", "content": prompt}],
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=body,
        headers={
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            payload = json.loads(resp.read().decode("utf-8", errors="replace"))
        content = payload["choices"][0]["message"]["content"]
    except Exception:
        return member

    start = content.find("{")
    end = content.rfind("}")
    if start == -1 or end == -1:
        return member
    try:
        data = json.loads(content[start : end + 1].strip())
    except Exception:
        return member

    try:
        llm_score = float(data.get("value_score", member["analysis"]["value_score"]))
    except Exception:
        llm_score = float(member["analysis"]["value_score"])

    heuristic_score = float(member["analysis"]["value_score"])
    blended = round(min(10.0, max(1.0, (0.75 * llm_score) + (0.25 * heuristic_score))), 1)
    member["analysis"]["value_score"] = blended
    role_raw = str(data.get("role") or heuristic_role)[:60].strip()
    role_norm = role_raw
    if role_raw not in ALLOWED_ROLES:
        role_lower = role_raw.lower()
        if "solver" in role_lower or "problem" in role_lower:
            role_norm = "Problem Solver"
        elif "curat" in role_lower or "source" in role_lower:
            role_norm = "Curator"
        elif "comed" in role_lower or "joke" in role_lower:
            role_norm = "Comedian"
        elif "writer" in role_lower or "deep" in role_lower:
            role_norm = "Deep Writer"
        elif "ask" in role_lower:
            role_norm = "Asker"
        elif "ghost" in role_lower:
            role_norm = "Ghost"
        elif "member" in role_lower or "watch" in role_lower:
            role_norm = "Shadow Watcher"
        else:
            role_norm = heuristic_role

    if role_norm == "Member":
        role_norm = "Shadow Watcher"
    if role_norm == "Shadow Watcher" and heuristic_role != "Shadow Watcher":
        role_norm = heuristic_role

    member["analysis"]["role"] = role_norm
    member["analysis"]["vibe"] = str(data.get("vibe") or member["analysis"]["vibe"])[:140]

    if "badges" in data:
        raw_badges = data.get("badges") or []
        if isinstance(raw_badges, list):
            cleaned = []
            for badge in raw_badges:
                if not isinstance(badge, str):
                    continue
                badge = badge.strip()
                if badge in ALLOWED_BADGES and badge not in cleaned:
                    cleaned.append(badge)
            member["badges"] = cleaned
    return member


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Analyze WhatsApp chat exports into per-member analytics and a value score (not based on message count)."
    )
    parser.add_argument(
        "-i",
        "--input",
        action="append",
        default=[],
        help='Chat export path, directory, or glob (repeatable). Example: --input "WhatsApp Chat with*.txt"',
    )
    parser.add_argument("-o", "--output", default=_default_output_path(), help="Output JSON path.")
    parser.add_argument("--llm", action="store_true", help="Enrich role/vibe/score using OpenRouter (requires network + API key).")
    args = parser.parse_args(argv)

    inputs = args.input or ["WhatsApp Chat with*.txt"]
    paths = _expand_inputs(inputs)
    if not paths:
        print("No input files found.", file=sys.stderr)
        return 2

    for p in paths:
        if not p.exists():
            print(f"Missing input: {p}", file=sys.stderr)
            return 2

    print(f"Parsing {len(paths)} export(s)...")
    messages = parse_whatsapp_export_files(paths)
    participants = extract_system_participants_from_files(paths)
    print(f"Parsed {len(messages)} messages.")

    members = analyze_members(messages, participants=participants)

    if args.llm:
        print("LLM enrichment enabled (may be slow/costly).")
        enriched = []
        for idx, m in enumerate(members, start=1):
            if m["stats"]["messages"] < 8:
                enriched.append(m)
                continue
            print(f"[{idx}/{len(members)}] {m['name']}")
            enriched.append(_llm_enrich_member(m))
        members = sorted(enriched, key=lambda x: x["analysis"]["value_score"], reverse=True)

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(members, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
