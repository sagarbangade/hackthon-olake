# Ask OLake

Chat assistant for the OLake docs. Answers only from the official docs and blog, with source links.

Live: https://hackthon-olake.vercel.app (`POST /ask`, chat page at `/`, widget at `/widget.js`)

## Architecture

**RAG pipeline**

```
POST /ask {question}
  -> validate + rate limit
  -> guardrails (injection / off-topic / unsupported systems) -> fixed reply, no LLM call
  -> hybrid search -> top chunks with their olake.io URLs
  -> LLM answers only from those chunks and cites them [1], [2]
  -> {answer, sources}
```

**Chunking.** `scripts/ingest.mjs` reads the [olake-docs](https://github.com/datazip-inc/olake-docs) repo (docs + blog, 210 pages), inlines shared MDX snippets, strips JSX, and splits each page by heading into ~1500 character chunks (~2950 chunks). Each chunk keeps its page URL for citations.

**Retrieval / hybrid search.** Chunks are stored in Qdrant with two vectors, made by Qdrant Cloud Inference:
- dense (`all-minilm-l6-v2`) for meaning
- sparse BM25 for exact terms like `wal_level` or `binlog_format`

Both are queried together and merged with Reciprocal Rank Fusion. For core topics (sync modes, catalogs, CDC setup...) the matching doc page is always included. If Qdrant is down, a local BM25 search over the same chunks is used.

## Model routing, fallbacks and cost

- Primary model `z-ai/glm-4.7-flash` via OpenRouter, with automatic fallback to `google/gemini-2.5-flash-lite` and `deepseek/deepseek-v4.1-flash` (OpenRouter `models` param). Retry on 429.
- If all models fail, `/ask` returns 503 with links to the most relevant docs.
- `GET /model` shows which models are in use.
- Cost: `max_tokens: 500`, reasoning off, only top chunks sent, and guardrail questions never call the LLM.

## Prompt security and injection defense

- API keys only in environment variables.
- Requests to reveal the prompt or keys are refused before reaching the LLM.
- Off-topic requests are politely redirected to OLake.
- User text is wrapped in `<question>` tags and can't change the system rules.
- Any key-like text in the output is masked.
- Input length limit and per-IP rate limiting.

## Deployment

**Local**

```bash
npm install
cp .env.example .env.local   # add keys
node --env-file=.env.local scripts/ingest.mjs ../olake-docs   # build index (clone olake-docs first)
npm run dev
```

**Cloud (Vercel)**

1. Import the repo on vercel.com/new (Next.js is auto detected).
2. Set `LLM_PROVIDER=openrouter`, `OPENROUTER_API_KEY`, `QDRANT_URL`, `QDRANT_API_KEY`.
3. Deploy.
