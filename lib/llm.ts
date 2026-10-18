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
    models: ["llama-3.3-70b-versatile"],
  },
};

export const provider = process.env.LLM_PROVIDER === "groq" ? "groq" : "openrouter";
const cfg = PROVIDERS[provider];
export const models = cfg.models;

type Msg = { role: "system" | "user" | "assistant"; content: string };

export async function chat(messages: Msg[]): Promise<{ text: string; model: string }> {
  const body: any = { model: models[0], messages, max_tokens: 500, temperature: 0.1 };
  if (provider === "openrouter") {
    body.models = models.slice(1); // openrouter falls back to these if the first one fails
    body.reasoning = { effort: "none" };
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });
    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    if (!res.ok) throw new Error(`llm ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return { text: data.choices?.[0]?.message?.content?.trim() || "", model: data.model };
  }
  throw new Error("llm rate limited");
}
