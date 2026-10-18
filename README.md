# Ask OLake

Chat assistant for the [OLake](https://olake.io) docs, built for Hacktoberfest Hack Day Bengaluru x OLake.

It answers questions about OLake only from the official docs and blog, cites the source pages, and says clearly when something is not supported or not in the docs.

**Live:** https://hackthon-olake.vercel.app

| Endpoint | What it does |
|---|---|
| `POST /ask` | the API: `{question}` -> `{answer, sources}` |
| `GET /model` | shows which LLM provider and models are in use |
| `/` | chat page |
| `/widget.js` | embeddable chat widget |

## API

```bash
curl -X POST https://hackthon-olake.vercel.app/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "Which source databases can OLake ingest data from?"}'
```

```json
{
  "answer": "OLake can ingest from PostgreSQL, MySQL, MongoDB, Oracle, MSSQL, IBM DB2, Apache Kafka and Amazon S3 [1].",
  "sources": ["https://olake.io/docs/"]
}
```

| Status | When |
|---|---|
| `200` | answer (also used for refusals) |
| `400` | missing / empty question, bad JSON, question over 1000 chars |
| `429` | more than 20 requests per minute from one IP |
| `503` | LLM down, answer then lists the most relevant doc links |

Errors use the same `{answer, sources}` shape so clients don't need special handling. CORS is open so the widget works from any docs domain.

## Embed in a docs site

```html
<script src="https://hackthon-olake.vercel.app/widget.js" defer></script>
```

Adds a floating "Ask OLake" button that opens the chat in an iframe, so it never clashes with the host page's CSS. The chat supports markdown, highlighted code blocks with a copy button, source link chips, and works on mobile.

## Architecture

```
                  OFFLINE (scripts/ingest.mjs)
  olake-docs repo (docs + blog, 210 pages)
        -> clean MDX, inline shared snippets
        -> split by heading, ~1500 chars (~2950 chunks, each with its olake.io URL)
        -> data/chunks.json  +  Qdrant collection (dense + BM25 vectors)

                  ONLINE (app/ask/route.ts)
  POST /ask
    1. validate input, rate limit
    2. guardrails: injection / secrets / off-topic / unsupported system -> fixed reply, no LLM call
    3. retrieve (lib/search.ts)
         pinned doc page for known topics (best 4 chunks of that page)
       + Qdrant hybrid search: dense (all-minilm-l6-v2) + bm25, fused with RRF
         (falls back to local BM25 with MiniSearch if Qdrant fails)
       -> up to 10 chunks
    4. LLM (lib/llm.ts) with numbered chunks, must cite them as [1], [2]
    5. mask any key-like text, sources = urls of the cited chunks
```

### RAG pipeline and chunking

`scripts/ingest.mjs` reads the [olake-docs](https://github.com/datazip-inc/olake-docs) repo directly instead of scraping the site, so the text is clean. For each page it:

- reads the frontmatter (title, slug),
- inlines shared MDX snippets (config examples live in `docs/shared/` and are imported into pages),
- strips imports, JSX components, images and comments,
- builds the real page URL from the file path / slug the same way Docusaurus does (checked against the sitemap),
- splits at `#`/`##`/`###` headings into chunks of ~1500 chars. Each chunk starts with `Page title > Section heading` so even a small chunk has context.

### Retrieval: hybrid search

- **Dense vectors** (`sentence-transformers/all-minilm-l6-v2`) match meaning, e.g. "make Postgres stream changes" -> logical replication.
- **BM25 sparse vectors** (`qdrant/bm25`) match exact terms. This matters a lot here because users ask about exact names like `binlog_format`, `wal_level` or `_op_type`.
- Both run in one Qdrant query and are fused with **Reciprocal Rank Fusion**.
- Embeddings are made by **Qdrant Cloud Inference**, so there is no separate embedding API or key.
- **Pinned pages:** some topics have one source-of-truth page (sync modes -> terminology, catalogs -> compatibility page, Postgres CDC -> generic setup...). For those, the best 4 sections of that page are always added, using topic keywords to pick the right sections.
- **Fallback:** if Qdrant is down or not configured, the same chunks are searched locally with MiniSearch (BM25, stopwords removed, docs ranked above blog posts). The API keeps working without Qdrant.

## Model routing, fallbacks and cost

`lib/llm.ts` is one `fetch` wrapper, the provider is picked by `LLM_PROVIDER`:

- **`openrouter`** (production): `z-ai/glm-4.7-flash` first. OpenRouter's `models` param falls back automatically to `google/gemini-2.5-flash-lite` and then `deepseek/deepseek-v4.1-flash` if a model errors. On `429` we wait (using `retry-after`) and retry.
- **`groq`**: used only during development so we didn't spend the hackathon credit while testing.
- If every model fails, `/ask` returns `503` with links to the best matching doc pages, so the user still gets something useful.

Token and cost control ($3 credit):

- `max_tokens: 500`, `reasoning: { effort: "none" }`, temperature 0.1
- only the top chunks go in the prompt, never whole pages
- injection, off-topic and unsupported-system questions are answered without calling the LLM at all
- `GET /model` shows the active provider, so it's easy to check production uses the provided models

## Accuracy and honesty

- The prompt says to answer only from the excerpts, keep exact config / command names, and cite every excerpt used.
- It has the fixed list of the 8 supported sources and 2 destinations (that list comes from a React component on the docs site that isn't in the markdown).
- Questions about systems OLake doesn't have (Cassandra, Delta Lake, Hudi, Redis...) get a fixed reply: "**X is not supported by OLake**" plus what is supported. No setup steps, no LLM call.
- If the excerpts don't have the answer, the model must say "I couldn't find this in the OLake docs" and point to the [community Slack](https://olake.io/docs/community/channels/) instead of guessing.
- `sources` are only the pages the answer actually cited.

## Prompt security and injection defense

- **Keys** only live in environment variables, never in the repo or the client.
- **Pre-LLM guardrails:** requests to reveal our prompt, rules or keys ("ignore previous instructions", "print your system prompt", "your API key"...) get a fixed refusal and never reach the model. Normal questions like "how do I set the API key for the REST catalog?" are still answered.
- **Off-topic** requests (poems, jokes, songs...) get a polite redirect to OLake topics.
- **Prompt isolation:** the user's text is wrapped in `<question>` tags and the system prompt says that text can't change the rules.
- **Output check:** anything that looks like a key (`sk-or-v1...`, `gsk_...`, JWTs) is masked before the answer is returned.
- **Input limits:** 1000 characters max, JSON only, and per-IP rate limiting.

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in keys
npm run dev                  # http://localhost:3000
```

Run the 20 benchmark questions (checks the must-mention words):

```bash
node scripts/eval.mjs http://localhost:3000
```

Build / refresh the docs index (needed once, and whenever the docs change):

```bash
git clone --depth 1 https://github.com/datazip-inc/olake-docs ../olake-docs
node --env-file=.env.local scripts/ingest.mjs ../olake-docs
```

## Deploy (Vercel)

1. Import this repo on vercel.com/new. Next.js is detected automatically, no extra config needed.
2. Add environment variables:
   ```
   LLM_PROVIDER=openrouter
   OPENROUTER_API_KEY=...
   QDRANT_URL=...
   QDRANT_API_KEY=...
   ```
3. Deploy, then check `GET /model` shows `openrouter`.
4. Make sure Deployment Protection doesn't block the production URL.

Every push to `main` redeploys automatically.

## Design choices

- **Next.js on Vercel:** API, chat UI and widget in one small project, zero-config deploys.
- **Hybrid search instead of only vectors:** questions use exact technical names, pure embeddings blur them.
- **Qdrant + local fallback:** better retrieval when Qdrant is up, still working when it isn't.
- **Guardrails before the LLM:** safer and cheaper than asking the model to refuse.
- **No framework (LangChain etc.):** the whole pipeline is a few hundred lines and easy to follow.

## Files

```
app/ask/route.ts     /ask endpoint: validation, guardrails, prompt, sources
app/model/route.ts   /model endpoint
app/page.tsx         chat UI
lib/search.ts        Qdrant hybrid search, pinned pages, local fallback
lib/llm.ts           Groq / OpenRouter call with fallbacks
public/widget.js     embed script
scripts/ingest.mjs   docs -> chunks -> Qdrant
scripts/eval.mjs     runs the 20 test questions
data/chunks.json     docs chunks
```
