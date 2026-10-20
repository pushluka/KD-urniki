import { serverApi, unavailable } from "@/lib/server/clients";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return serverApi()?.list(request) ?? unavailable();
}
export async function POST(request: Request) {
  return serverApi()?.create(request) ?? unavailable();
}
