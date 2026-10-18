"use client";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

type Msg = { role: "user" | "bot"; text: string; sources?: string[] };

const EXAMPLES = [
  "Which sources can OLake ingest from?",
  "How do I set up Postgres CDC?",
  "What sync modes are there?",
  "Which Iceberg catalogs are supported?",
];

function Pre(props: any) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="code">
      <button
        onClick={() => {
          navigator.clipboard
            ?.writeText(ref.current?.innerText || "")
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => {});
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre ref={ref} {...props} />
    </div>
  );
}

function shortUrl(u: string) {
  return u.replace("https://olake.io", "").replace(/\/$/, "") || "/";
}

export default function Home() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [embed, setEmbed] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setEmbed(new URLSearchParams(window.location.search).has("embed"));
    }
  }, []);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, loading]);

  async function ask(q: string) {
    q = q.trim();
    if (!q || loading) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setLoading(true);
    try {
      const res = await fetch("/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      setMsgs((m) => [...m, { role: "bot", text: data.answer, sources: data.sources }]);
    } catch {
      setMsgs((m) => [...m, { role: "bot", text: "Something went wrong, please try again." }]);
    }
    setLoading(false);
  }

  return (
    <main className={embed ? "chat embed" : "chat"}>
      <header>
        <b>Ask OLake</b>
        <span>answers from the OLake docs</span>
      </header>

      <div className="messages">
        {!msgs.length && (
          <div className="empty">
            <p>Hi! Ask me anything about OLake.</p>
            <div className="examples">
              {EXAMPLES.map((e) => (
                <button key={e} onClick={() => ask(e)}>{e}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={"msg " + m.role}>
            {m.role === "user" ? (
              m.text
            ) : (
              <>
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{ pre: Pre, a: (p) => <a {...p} target="_blank" /> }}>
                  {m.text}
                </ReactMarkdown>
                {!!m.sources?.length && (
                  <div className="sources">
                    {m.sources.map((s) => (
                      <a key={s} href={s} target="_blank">{shortUrl(s)}</a>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
        {loading && <div className="msg bot dots"><span /><span /><span /></div>}
        <div ref={end} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); ask(input); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about OLake..." maxLength={1000} />
        <button disabled={loading || !input.trim()}>Send</button>
      </form>
    </main>
  );
}
