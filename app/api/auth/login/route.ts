import { serverApi, unavailable } from "@/lib/server/clients";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return serverApi()?.login(request) ?? unavailable();
}
