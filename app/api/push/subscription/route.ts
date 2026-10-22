import { pushServer } from "@/lib/server/push-clients";
import { unavailable } from "@/lib/server/clients";
export const runtime = "nodejs";
export async function GET(req: Request) {
  return pushServer()?.status(req) ?? unavailable();
}
export async function POST(req: Request) {
  return pushServer()?.subscribe(req) ?? unavailable();
}
export async function DELETE(req: Request) {
  return pushServer()?.unsubscribe(req) ?? unavailable();
}
