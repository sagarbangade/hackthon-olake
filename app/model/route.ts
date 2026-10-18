import { provider, models } from "@/lib/llm";

// shows which llm the /ask endpoint is using
export function GET() {
  return Response.json({ provider, primary: models[0], fallbacks: models.slice(1) });
}
