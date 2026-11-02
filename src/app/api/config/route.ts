import { publicConfig } from "@/lib/server/config";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(publicConfig(), { headers: { "cache-control": "no-store" } });
}
