import { googleServer } from "@/lib/server/google-clients";
import { pushServer } from "@/lib/server/push-clients";
import { unavailable } from "@/lib/server/clients";
export const runtime = "nodejs";
export const maxDuration = 60;
async function dispatchGoogle(req: Request) {
  try {
    await googleServer()?.dispatch(req);
  } catch {
    /* Independent queue: configuration/network failures never block Web Push. */
  }
}
export async function GET(req: Request) {
  // Independent durable queues: a Google failure must never prevent Web Push.
  const [push] = await Promise.all([
    pushServer()?.dispatch(req) ?? Promise.resolve(unavailable()),
    dispatchGoogle(req),
  ]);
  return push;
}
export async function POST(req: Request) {
  // Independent durable queues: a Google failure must never prevent Web Push.
  const [push] = await Promise.all([
    pushServer()?.dispatch(req) ?? Promise.resolve(unavailable()),
    dispatchGoogle(req),
  ]);
  return push;
}
