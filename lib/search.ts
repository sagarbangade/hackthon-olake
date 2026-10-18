import MiniSearch from "minisearch";
import chunks from "@/data/chunks.json";

export type Chunk = { id: number; url: string; title: string; text: string };

const { QDRANT_URL, QDRANT_API_KEY } = process.env;
const DOCS = "https://olake.io/docs/";

// some topics live on one known page, always pull that page in.
// the extra words help pick the right section of that page
const PINNED: [RegExp, string, string][] = [
  [/sync mode|incremental|full refresh/i, DOCS + "understanding/terminologies/olake/", "sync modes full refresh cdc incremental cursor state deletes"],
  [/upsert|append/i, DOCS + "understanding/terminologies/olake/", "upsert append default kafka history latest"],
  [/column|_op_type|_olake|metadata/i, DOCS + "understanding/terminologies/general/", "_op_type _olake_id _olake_timestamp _cdc_timestamp"],
  [/continuous|daemon|real.?time|always running/i, "https://olake.io/blog/olake-architecture-deep-dive/", "cdc initial_wait_time bounded session exits schedule"],
  [/catalog|glue|hive|nessie|polaris|unity|lakekeeper/i, DOCS + "understanding/compatibility-catalogs/", "glue hive jdbc rest catalog"],
  [/query engine|trino|athena|spark|duckdb|snowflake/i, DOCS + "understanding/compatibility-engines/", "spark trino athena duckdb snowflake"],
  [/mysql/i, DOCS + "connectors/mysql/setup/generic/", "binlog_format binlog_row_image binlog_row_metadata server-id create replication user grant"],
  [/postgres/i, DOCS + "connectors/postgres/setup/generic/", "wal_level logical pgoutput max_replication_slots max_wal_senders replication slot publication"],
  [/mongo/i, DOCS + "connectors/mongodb/cdc_setup/", "replica set oplog"],
  [/install|docker|login|password|olake ui/i, DOCS + "install/olake-ui/", "docker compose localhost:8000 admin password x-signup-defaults"],
  [/\bcli\b|command|flag/i, DOCS + "community/commands-and-flags/", "check spec clear-destination commands"],
  [/cron|schedul/i, DOCS + "getting-started/job-level-properties/", "cron 5-field 7-field quartz"],
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

export async function search(q: string, limit = 10): Promise<Chunk[]> {
  const pinned = PINNED.filter(([re]) => re.test(q))
    .slice(0, 2)
    .flatMap(([, url, words]) => localSearch(words, 4, url));

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
