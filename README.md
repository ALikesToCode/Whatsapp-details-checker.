# WhatsApp Details Checker

## CLI (generate `members.json`)

From the repo root:

```bash
python3 analyze_chat.py --input "WhatsApp Chat with*.txt" --output web/public/data/members.json
```

- By default this uses heuristics (not message count) to compute `value_score`.
- Optional LLM enrichment (requires `OPENROUTER_API_KEY` and network access):

```bash
python3 analyze_chat.py --input "WhatsApp Chat with*.txt" --output web/public/data/members.json --llm
```

## Web app

```bash
cd web
pnpm install
pnpm dev
```

- Upload one or more WhatsApp `.txt` exports in the UI (runs locally in the browser).
- The generated `web/public/data/members.json` is intentionally gitignored.
