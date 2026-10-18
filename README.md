# Ask OLake

Chat assistant for the [OLake](https://olake.io) docs. Built for Hacktoberfest Hack Day Bengaluru x OLake.

It answers questions about OLake only from the official docs and blog, gives the source links, and says clearly when something is not supported or not in the docs.

- `POST /ask` - the API
- `GET /model` - shows which LLM is being used
- `/` - chat page
- `/widget.js` - embeddable chat widget

## API

```bash
curl -X POST https://<your-app>.vercel.app/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "Which source databases can OLake ingest data from?"}'
```

```json
{
  "answer": "OLake can ingest from PostgreSQL, MySQL, MongoDB, Oracle, MSSQL, IBM DB2, Apache Kafka and Amazon S3 [1].",
  "sources": ["https://olake.io/docs/"]
}
```

Errors return the same shape: `400` for a bad body, `429` when rate limited, `503` when the LLM is down (the answer then lists the most relevant doc links instead).

## Embed in a docs site

```html
<script src="https://<your-app>.vercel.app/widget.js" defer></script>
```

This adds a floating "Ask OLake" button that opens the chat in an iframe, so it doesn't clash with the host page's CSS.

## How it works

```
question
  -> validate + rate limit (20 req/min per IP)
  -> guardrails: prompt injection / secrets / off-topic -> fixed reply, no LLM call
  -> search: Qdrant hybrid (dense + BM25, RRF) + pinned pages for known topics
             (falls back to local BM25 with MiniSearch if Qdrant is down)
  -> LLM with top 6 chunks, must cite them as [1], [2]
  -> sources = urls of the chunks it cited
```

**Data.** `scripts/ingest.mjs` reads the [olake-docs](https://github.com/datazip-inc/olake-docs) repo (docs + blog, ~210 pages). Shared MDX snippets are inlined, JSX is stripped, and pages are split by heading into ~1500 char chunks (~2900 chunks). Every chunk keeps its page URL, which is built from the file path / slug the same way Docusaurus does. Chunks are saved to `data/chunks.json` and uploaded to Qdrant.

**Search.** Qdrant Cloud Inference makes the embeddings (`all-minilm-l6-v2` dense + `qdrant/bm25` sparse), so there is no separate embedding API. Both are queried and fused with RRF in one request. Keyword search matters a lot here because questions use exact names like `binlog_format` or `_op_type`. For a few core topics (sync modes, catalogs, CDC setup...) the matching doc page is always added, since those pages are the source of truth.

**LLM.** One small `fetch` wrapper in `lib/llm.ts`, switched by `LLM_PROVIDER`:
- `openrouter` (final): `z-ai/glm-4.7-flash`, falls back to `google/gemini-2.5-flash-lite` then `deepseek/deepseek-v4.1-flash` using OpenRouter's `models` param. One retry on 429.
- `groq`: `llama-3.3-70b-versatile`, used only during development to save the hackathon credit.

**Cost.** `max_tokens: 500`, `reasoning: none`, temperature 0.1, only top 6 chunks in the prompt, and injection / off-topic questions never reach the LLM.

**Honesty.** The prompt has the fixed list of 8 sources and 2 destinations. Anything else must be answered with "not supported" and no setup steps. If the chunks don't have the answer it must say "I couldn't find this in the OLake docs" and point to the community Slack.

**Security.** Keys only live in env vars. Regex guardrails catch "ignore instructions / system prompt / api key" style questions before the LLM. The user question is wrapped in `<question>` tags and the prompt says that text can't change the rules. Any key-like string in the output is masked.

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in keys
npm run dev                  # http://localhost:3000
```

Run the 20 benchmark questions:

```bash
node scripts/eval.mjs http://localhost:3000
```

Rebuild the docs index (only needed when docs change):

```bash
git clone --depth 1 https://github.com/datazip-inc/olake-docs ../olake-docs
node --env-file=.env.local scripts/ingest.mjs ../olake-docs
```

## Deploy on Vercel

1. Import this repo on vercel.com/new (Next.js is auto detected, no config needed).
2. Add env vars: `LLM_PROVIDER=openrouter`, `OPENROUTER_API_KEY`, `QDRANT_URL`, `QDRANT_API_KEY`.
3. Deploy. Check `GET /model` shows `openrouter`.

## Files

```
app/ask/route.ts     /ask endpoint
app/model/route.ts   /model endpoint
app/page.tsx         chat UI
lib/search.ts        qdrant + local search
lib/llm.ts           groq / openrouter call
public/widget.js     embed script
scripts/ingest.mjs   docs -> chunks -> qdrant
scripts/eval.mjs     runs the 20 test questions
data/chunks.json     docs chunks
```
