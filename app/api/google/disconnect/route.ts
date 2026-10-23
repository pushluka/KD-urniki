import { googleServer } from "@/lib/server/google-clients";
import { unavailable } from "@/lib/server/clients";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(req: Request) {
  return googleServer()?.disconnect(req) ?? unavailable();
}
