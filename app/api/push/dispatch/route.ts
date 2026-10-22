import { pushServer } from "@/lib/server/push-clients";
import { unavailable } from "@/lib/server/clients";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function GET(req: Request) {
  return pushServer()?.dispatch(req) ?? unavailable();
}
export async function POST(req: Request) {
  return pushServer()?.dispatch(req) ?? unavailable();
}
