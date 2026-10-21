import { serverApi, unavailable } from "@/lib/server/clients";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return serverApi()?.passwordStatus(request) ?? unavailable();
}
