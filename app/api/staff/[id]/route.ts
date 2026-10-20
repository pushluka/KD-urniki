import { serverApi, unavailable } from "@/lib/server/clients";
export const runtime = "nodejs";
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return serverApi()?.update(request, id) ?? unavailable();
}
