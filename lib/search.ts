import MiniSearch from "minisearch";
import chunks from "@/data/chunks.json";

export type Chunk = { id: number; url: string; title: string; text: string };

const { QDRANT_URL, QDRANT_API_KEY } = process.env;

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
  if (!res.ok) throw new Error(`qdrant ${res.status}`);
  const data = await res.json();
  return data.result.points.map((p: any) => ({ id: p.id, ...p.payload }));
}

// local keyword search, used when qdrant is not set or down
let mini: MiniSearch<Chunk> | null = null;
function localSearch(q: string, limit: number): Chunk[] {
  if (!mini) {
    mini = new MiniSearch<Chunk>({ fields: ["title", "text"], storeFields: ["url", "title", "text"] });
    mini.addAll(chunks as Chunk[]);
  }
  return mini
    .search(q, { boost: { title: 2 }, fuzzy: 0.1, prefix: true })
    .slice(0, limit) as unknown as Chunk[];
}

export async function search(q: string, limit = 5): Promise<Chunk[]> {
  if (QDRANT_URL && QDRANT_API_KEY) {
    try {
      return await qdrantSearch(q, limit);
    } catch (e) {
      console.error("qdrant failed, using local search", e);
    }
  }
  return localSearch(q, limit);
}
