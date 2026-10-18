export const dynamic = "force-dynamic";

// git commit that vercel built this deployment from
export function GET() {
  return Response.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA || "local",
    message: process.env.VERCEL_GIT_COMMIT_MESSAGE || "",
    branch: process.env.VERCEL_GIT_COMMIT_REF || "",
  });
}
