import MiniSearch from "minisearch";
import chunks from "@/data/chunks.json";

export type Chunk = { id: number; url: string; title: string; text: string };

const { QDRANT_URL, QDRANT_API_KEY } = process.env;
const DOCS = "https://olake.io/docs/";

// some topics live on one known page, always pull that page in
const PINNED: [RegExp, string][] = [
  [/sync mode|incremental|full refresh|upsert|append|normaliz/i, DOCS + "understanding/terminologies/olake/"],
  [/column|_op_type|_olake|metadata/i, DOCS + "understanding/terminologies/general/"],
  [/continuous|daemon|real.?time|always running/i, "https://olake.io/blog/olake-architecture-deep-dive/"],
  [/catalog|glue|hive|nessie|polaris|unity|lakekeeper/i, DOCS + "understanding/compatibility-catalogs/"],
  [/query engine|trino|athena|spark|duckdb|snowflake/i, DOCS + "understanding/compatibility-engines/"],
  [/mysql/i, DOCS + "connectors/mysql/setup/generic/"],
  [/postgres/i, DOCS + "connectors/postgres/setup/generic/"],
  [/mongo/i, DOCS + "connectors/mongodb/cdc_setup/"],
  [/install|docker|login|password|olake ui/i, DOCS + "install/olake-ui/"],
  [/cli|command|flag/i, DOCS + "community/commands-and-flags/"],
  [/cron|schedul/i, DOCS + "getting-started/job-level-properties/"],
];

const STOP = new Set(
  "what which where when how is are do does i my me can to the a an of in on for and or with olake it be need any from that this you your use using".split(" ")
);

const mini = new MiniSearch<Chunk>({
  fields: ["title", "text"],
  storeFields: ["url", "title", "text"],
  processTerm: (t) => (STOP.has(t.toLowerCase()) ? null : t.toLowerCase()),
});
mini.addAll(chunks as Chunk[]);

function localSearch(q: string, limit: number, url?: string): Chunk[] {
  return mini
    .search(q, {
      boost: { title: 3 },
      boostDocument: (_id, _t, doc: any) => (doc.url.includes("/docs/") ? 2 : 1), // docs over blog posts
      filter: url ? (r) => r.url === url : undefined,
    })
    .slice(0, limit) as unknown as Chunk[];
}

// hybrid search in qdrant: dense (minilm) + bm25, merged with RRF
async function qdrantSearch(q: string, limit: number): Promise<Chunk[]> {
  const res = await fetch(`${QDRANT_URL}/collections/olake_docs/points/query`, {
    method: "POST",
    headers: { "api-key": QDRANT_API_KEY!, "content-type": "application/json" },
    body: JSON.stringify({
      prefetch: [
        { query: { text: q, model: "sentence-transformers/all-minilm-l6-v2" }, using: "dense", limit: 20 },
        { query: { text: q, model: "qdrant/bm25" }, using: "bm25", limit: 20 },
      ],
      query: { fusion: "rrf" },
      limit,
      with_payload: true,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`qdrant ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.result.points.map((p: any) => ({ id: p.id, ...p.payload }));
}

export async function search(q: string, limit = 6): Promise<Chunk[]> {
  const pinned = PINNED.filter(([re]) => re.test(q)).slice(0, 2).flatMap(([, url]) => localSearch(q, 2, url));

  let found: Chunk[] = [];
  if (QDRANT_URL && QDRANT_API_KEY) {
    try {
      found = await qdrantSearch(q, limit);
    } catch (e) {
      console.error("qdrant failed, using local search", e);
    }
  }
  if (!found.length) found = localSearch(q, limit);

  const seen = new Set<number>();
  return [...pinned, ...found].filter((c) => !seen.has(c.id) && seen.add(c.id)).slice(0, limit);
}
