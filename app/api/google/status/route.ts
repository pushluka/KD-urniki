import { googleServer } from "@/lib/server/google-clients";
import { unavailable } from "@/lib/server/clients";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function GET(req: Request) {
  return googleServer()?.status(req) ?? unavailable();
}
