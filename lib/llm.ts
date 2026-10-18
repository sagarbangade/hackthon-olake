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
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    // each retry starts from the next model, so a slow or broken model is skipped
    const current = models[attempt % models.length];
    const body: any = { model: current, messages, max_tokens: 500, temperature: 0.1 };
    if (provider === "openrouter") {
      body.models = models.filter((m) => m !== current); // openrouter falls back to these on errors
      body.reasoning = { effort: "none" };
    }

    try {
      const res = await fetch(cfg.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12000),
      });
      if (res.status === 429) {
        const wait = parseFloat(res.headers.get("retry-after") || "2") * 1000;
        await new Promise((r) => setTimeout(r, Math.min(Math.max(wait, 1500), 6000)));
        throw new Error("llm 429");
      }
      if (!res.ok) throw new Error(`llm ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content?.trim();
      if (text) return { text, model: data.model };
      throw new Error("llm empty answer");
    } catch (e) {
      lastError = e; // timeout, 429, 5xx or empty -> try the next model
      console.error(`model ${current} failed:`, e);
    }
  }
  throw lastError;
}
