import { createClient } from "@/lib/supabase/server";
import { getOptionalEnv } from "./env";

export type IntegrationSource = "vault" | "env" | "none";

export type QwenConfiguration = {
  apiKey: string;
  baseUrl: string;
  model: string;
  source: IntegrationSource;
};

export type TelegramConfiguration = {
  botToken: string;
  ownerUserId: string;
  chatId: string;
  webhookSecret: string | null;
  source: IntegrationSource;
};

export type BybitDemoConfiguration = {
  apiKey: string;
  apiSecret: string;
  source: IntegrationSource;
} | null;

const DEFAULT_QWEN_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const DEFAULT_QWEN_MODEL = "qwen-turbo";

async function getIntegrationRow(integration: string) {
  try {
    const client = await createClient();
    const rpc = client as unknown as {
      rpc: (name: string, args: Record<string, unknown>) => Promise<{
        data: { config?: Record<string, string>; secret?: string } | null;
        error: { message: string } | null;
      }>;
    };
    const { data, error } = await rpc.rpc("owner_get_integration_configuration", { p_integration: integration });
    return error ? null : data;
  } catch {
    // The caller may have no owner session (for example, the scanner), or
    // Vault may be unavailable. Fall through to the environment fallback
    // rather than crashing the core trading path.
    return null;
  }
}

/**
 * Resolves Qwen credentials: Supabase Vault (dashboard-configured) overrides
 * the QWEN_API_KEY environment variable (or its legacy QWEN_SECRET alias).
 * Returns null when neither is set -
 * callers MUST treat that as "AI coach temporarily unavailable," never throw.
 */
export async function getQwenConfiguration(): Promise<QwenConfiguration | null> {
  const row = await getIntegrationRow("qwen");
  const vaultKey = row?.secret ?? null;

  if (vaultKey) {
    return {
      apiKey: vaultKey,
      baseUrl: row?.config?.baseUrl ?? DEFAULT_QWEN_BASE_URL,
      model: row?.config?.model ?? DEFAULT_QWEN_MODEL,
      source: "vault",
    };
  }

  const env = getOptionalEnv();
  const envApiKey = env.QWEN_API_KEY ?? env.QWEN_SECRET;
  if (envApiKey) {
    return {
      apiKey: envApiKey,
      baseUrl: env.QWEN_BASE_URL ?? DEFAULT_QWEN_BASE_URL,
      model: env.QWEN_MODEL ?? DEFAULT_QWEN_MODEL,
      source: "env",
    };
  }

  return null;
}

export async function getTelegramConfiguration(): Promise<TelegramConfiguration | null> {
  const row = await getIntegrationRow("telegram");
  const vaultToken = row?.secret ?? null;
  const config = row?.config ?? null;

  if (vaultToken) {
    return {
      botToken: vaultToken,
      ownerUserId: config?.ownerUserId ?? "",
      chatId: config?.chatId ?? "",
      webhookSecret: config?.webhookSecret ?? null,
      source: "vault",
    };
  }

  const env = getOptionalEnv();
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_OWNER_USER_ID && env.TELEGRAM_CHAT_ID) {
    return {
      botToken: env.TELEGRAM_BOT_TOKEN,
      ownerUserId: env.TELEGRAM_OWNER_USER_ID,
      chatId: env.TELEGRAM_CHAT_ID,
      webhookSecret: env.TELEGRAM_WEBHOOK_SECRET ?? null,
      source: "env",
    };
  }

  return null;
}

export async function getBybitDemoConfiguration(): Promise<BybitDemoConfiguration> {
  // Bybit Demo dashboard credentials are intentionally not implemented in
  // this build; environment fallback remains the only supported source.
  const env = getOptionalEnv();
  if (env.BYBIT_DEMO_API_KEY && env.BYBIT_DEMO_API_SECRET) {
    return { apiKey: env.BYBIT_DEMO_API_KEY, apiSecret: env.BYBIT_DEMO_API_SECRET, source: "env" };
  }

  return null;
}
