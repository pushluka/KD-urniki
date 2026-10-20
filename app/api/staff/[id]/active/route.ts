import { serverApi, unavailable } from "@/lib/server/clients";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return serverApi()?.active(request, id) ?? unavailable();
}
