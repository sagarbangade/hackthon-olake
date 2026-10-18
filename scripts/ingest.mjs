// Reads the olake-docs repo, splits pages into chunks, saves data/chunks.json
// and uploads the chunks to Qdrant (if QDRANT_URL is set).
// usage: node --env-file=.env.local scripts/ingest.mjs ../olake-docs
import fs from "fs";
import path from "path";

const DOCS = path.resolve(process.argv[2] || "../olake-docs");
const SITE = "https://olake.io";

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((f) => {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) return f.name === "shared" || f.name === "drafts" ? [] : walk(p);
    return /\.mdx?$/.test(f.name) ? [p] : [];
  });
}

function frontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n/);
  const meta = {};
  if (m) for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return { meta, body: m ? src.slice(m[0].length) : src };
}

// some pages import shared mdx snippets (config examples etc), put them inline
function inlineImports(body, file) {
  const imports = [...body.matchAll(/^import (\w+) from ['"](.+\.mdx?)['"];?$/gm)];
  for (const [, name, from] of imports) {
    const p = from.startsWith("@site/") ? path.join(DOCS, from.slice(6)) : path.resolve(path.dirname(file), from);
    if (!fs.existsSync(p)) continue;
    const text = frontmatter(fs.readFileSync(p, "utf8")).body;
    body = body.replace(new RegExp(`<${name}\\s*/>`, "g"), text);
  }
  return body;
}

function clean(body) {
  return body
    .replace(/^(import|export) .*$/gm, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/<\/?[A-Z][^>]*>/g, "")
    .replace(/<\/?(div|span|br|img|p|a|details|summary)[^>]*>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function docUrl(file, meta) {
  if (meta.slug?.startsWith("/")) return `${SITE}/docs${meta.slug.replace(/\/$/, "")}/`;
  let rel = path.relative(path.join(DOCS, "docs"), file).replace(/\.mdx?$/, "");
  rel = rel.split(path.sep).map((s) => s.replace(/^\d+-(?=\D)/, "")).join("/").replace(/\/?index$/, "");
  return `${SITE}/docs/${rel}${rel ? "/" : ""}`;
}

function blogUrl(file, meta) {
  const slug = meta.slug || path.basename(file).replace(/\.mdx?$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "");
  return `${SITE}/blog/${slug}/`;
}

function chunk(text, title, max = 1500) {
  const out = [];
  let heading = "";
  let buf = "";
  const push = () => { if (buf.trim().length > 50) out.push(`${title}${heading ? " > " + heading : ""}\n${buf.trim()}`); buf = ""; };
  for (const part of text.split(/\n(?=#{1,3} )/)) {
    const h = part.match(/^#{1,3} (.*)/);
    if (h) { push(); heading = h[1]; }
    if (buf.length + part.length > max) push();
    // very long sections (big tables, code) get cut in pieces
    for (let i = 0; i < part.length; i += max) buf += part.slice(i, i + max) + "\n";
  }
  push();
  return out;
}

const pages = [
  ...walk(path.join(DOCS, "docs")).map((f) => ["doc", f]),
  ...walk(path.join(DOCS, "blog")).map((f) => ["blog", f]),
];

const chunks = [];
for (const [kind, file] of pages) {
  const { meta, body } = frontmatter(fs.readFileSync(file, "utf8"));
  if (meta.draft === "true") continue;
  const url = kind === "doc" ? docUrl(file, meta) : blogUrl(file, meta);
  const title = meta.title || path.basename(file);
  for (const text of chunk(clean(inlineImports(body, file)), title)) {
    chunks.push({ id: chunks.length + 1, url, title, text });
  }
}

fs.writeFileSync("data/chunks.json", JSON.stringify(chunks));
console.log(`${pages.length} pages -> ${chunks.length} chunks`);
