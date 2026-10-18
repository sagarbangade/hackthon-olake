// Groq for local testing, OpenRouter (the hackathon key) for the final deploy.
// Switch with LLM_PROVIDER=groq | openrouter
const PROVIDERS = {
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    key: process.env.OPENROUTER_API_KEY,
    models: ["z-ai/glm-4.7-flash", "google/gemini-2.5-flash-lite", "deepseek/deepseek-v4.1-flash"],
  },
  groq: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    key: process.env.GROQ_API_KEY,
    models: ["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"],
  },
};

export const provider = process.env.LLM_PROVIDER === "groq" ? "groq" : "openrouter";
const cfg = PROVIDERS[provider];
export const models = cfg.models;

type Msg = { role: "system" | "user" | "assistant"; content: string };

export async function chat(messages: Msg[]): Promise<{ text: string; model: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const currentModel = provider === "groq" ? models[attempt % models.length] : models[0];
    const body: any = { model: currentModel, messages, max_tokens: 500, temperature: 0.1 };
    if (provider === "openrouter") {
      body.models = models.slice(1); // openrouter falls back to these if the first one fails
      body.reasoning = { effort: "none" };
    }

    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });
    if (res.status === 429 && attempt < 2) {
      const retrySec = parseFloat(res.headers.get("retry-after") || "2");
      const waitMs = Math.min(Math.max(retrySec * 1000, 1500), 6000);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    if (!res.ok) throw new Error(`llm ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return { text: data.choices?.[0]?.message?.content?.trim() || "", model: data.model };
  }
  throw new Error("llm rate limited");
}
