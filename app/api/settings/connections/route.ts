import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { setVaultSecret } from "@/lib/config/vault";
import { getQwenConfiguration, getTelegramConfiguration } from "@/lib/config/integrations";

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

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const admin = createAdminClient();
  const body = parsed.data;

  if (body.integration === "qwen") {
    if (body.apiKey) {
      const secretName = "qwen_api_key";
      await setVaultSecret(secretName, body.apiKey);
      await admin.from("integration_credentials").upsert(
        {
          integration: "qwen",
          vault_secret_name: secretName,
          config: { baseUrl: body.baseUrl, model: body.model } as never,
          status: "CONFIGURED",
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "integration" },
      );
    } else {
      // Config-only update (base URL / model) without touching the secret.
      await admin.from("integration_credentials").upsert(
        {
          integration: "qwen",
          config: { baseUrl: body.baseUrl, model: body.model } as never,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "integration" },
      );
    }
  } else {
    if (body.botToken) {
      const secretName = "telegram_bot_token";
      await setVaultSecret(secretName, body.botToken);
      await admin.from("integration_credentials").upsert(
        {
          integration: "telegram",
          vault_secret_name: secretName,
          config: { ownerUserId: body.ownerUserId, chatId: body.chatId } as never,
          status: "CONFIGURED",
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "integration" },
      );
    } else {
      await admin.from("integration_credentials").upsert(
        {
          integration: "telegram",
          config: { ownerUserId: body.ownerUserId, chatId: body.chatId } as never,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "integration" },
      );
    }
  }

  await admin.from("audit_events").insert({
    actor: user.email ?? user.id,
    action: "integration_credentials_updated",
    metadata: { integration: body.integration, credential_source: "vault" },
  });

  return NextResponse.json({ ok: true });
}

export async function GET() {
  const [qwen, telegram] = await Promise.all([getQwenConfiguration(), getTelegramConfiguration()]);
  return NextResponse.json({
    qwen: qwen ? { configured: true, source: qwen.source, baseUrl: qwen.baseUrl, model: qwen.model } : { configured: false },
    telegram: telegram ? { configured: true, source: telegram.source } : { configured: false },
  });
}
