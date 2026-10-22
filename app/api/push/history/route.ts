import { pushServer } from "@/lib/server/push-clients";
import { unavailable } from "@/lib/server/clients";
export const runtime = "nodejs";
export async function GET(req: Request) {
  return pushServer()?.history(req) ?? unavailable();
}
export async function PATCH(req: Request) {
  return pushServer()?.markRead(req) ?? unavailable();
}
