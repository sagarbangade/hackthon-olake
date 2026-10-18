import { provider, models } from "@/lib/llm";

// same info as /model, the submission form asks for /version
export function GET() {
  return Response.json({ name: "ask-olake", version: "1.0.0", provider, primary: models[0], fallbacks: models.slice(1) });
}
