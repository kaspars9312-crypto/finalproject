import { timingSafeEqual } from "node:crypto";
import { processUpdate } from "../../../../server/telegram/controller";
import { parseUpdate } from "../../../../server/telegram/types";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "Webhook is not configured." }, { status: 503 });
  const supplied = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  const expectedBytes = Buffer.from(secret);
  const suppliedBytes = Buffer.from(supplied);
  if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  let json: unknown;
  try { json = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  const update = parseUpdate(json);
  if (update) {
    try { await processUpdate(update); }
    catch { return Response.json({ error: "Processing unavailable." }, { status: 503 }); }
  }
  return Response.json({ ok: true });
}
