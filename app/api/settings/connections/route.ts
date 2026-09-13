import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getQwenConfiguration, getTelegramConfiguration } from "@/lib/config/integrations";
import { isOwner } from "@/lib/auth/authorization";

const bodySchema = z.discriminatedUnion("integration", [
  z.object({
    integration: z.literal("qwen"),
    apiKey: z.string().min(1).optional(),
    baseUrl: z.string().url().optional(),
    model: z.string().min(1).optional(),
  }),
  z.object({
    integration: z.literal("telegram"),
    botToken: z.string().min(1).optional(),
    ownerUserId: z.string().min(1).optional(),
    chatId: z.string().min(1).optional(),
  }),
]);

/**
 * Saves a dashboard-managed integration credential. Requires an
 * authenticated session. Secrets are written ONLY to Supabase Vault via the
 * service-role RPC wrapper - never to an ordinary table, never echoed back.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOwner(user)) return NextResponse.json({ error: "Owner access required" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const body = parsed.data;
  const rpc = supabase as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
  };
  const secret = body.integration === "qwen" ? body.apiKey : body.botToken;
  const config = body.integration === "qwen"
    ? { baseUrl: body.baseUrl, model: body.model }
    : { ownerUserId: body.ownerUserId, chatId: body.chatId };
  const { error } = await rpc.rpc("owner_set_integration_configuration", {
    p_integration: body.integration,
    p_secret: secret ?? null,
    p_config: Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined)),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOwner(user)) return NextResponse.json({ error: "Owner access required" }, { status: 403 });

  const [qwen, telegram] = await Promise.all([getQwenConfiguration(), getTelegramConfiguration()]);
  return NextResponse.json({
    qwen: qwen ? { configured: true, source: qwen.source, baseUrl: qwen.baseUrl, model: qwen.model } : { configured: false },
    telegram: telegram ? { configured: true, source: telegram.source } : { configured: false },
  });
}
