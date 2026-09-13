import { createAdminClient } from "@/lib/supabase/server";
import { getVaultSecret } from "./vault";
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
    const admin = createAdminClient();
    const { data } = await admin
      .from("integration_credentials")
      .select("config, vault_secret_name")
      .eq("integration", integration)
      .maybeSingle();
    return data;
  } catch {
    // Supabase itself may not be fully configured yet (e.g. SUPABASE_SECRET_KEY
    // missing), or the lookup may fail for other reasons. Either way, a
    // dashboard-managed override is just unavailable - fall through to the
    // environment-variable fallback rather than crashing the whole
    // configuration resolution (spec: integrations must degrade gracefully).
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
  const vaultKey = row?.vault_secret_name ? await getVaultSecret(row.vault_secret_name) : null;

  if (vaultKey) {
    return {
      apiKey: vaultKey,
      baseUrl: (row?.config as Record<string, string> | null)?.baseUrl ?? DEFAULT_QWEN_BASE_URL,
      model: (row?.config as Record<string, string> | null)?.model ?? DEFAULT_QWEN_MODEL,
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
  const vaultToken = row?.vault_secret_name ? await getVaultSecret(row.vault_secret_name) : null;
  const config = (row?.config as Record<string, string> | null) ?? null;

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
  const row = await getIntegrationRow("bybit_demo");
  const vaultKey = row?.vault_secret_name ? await getVaultSecret(row.vault_secret_name) : null;
  const config = (row?.config as Record<string, string> | null) ?? null;

  if (vaultKey && config?.apiSecretVaultName) {
    const apiSecret = await getVaultSecret(config.apiSecretVaultName);
    if (apiSecret) return { apiKey: vaultKey, apiSecret, source: "vault" };
  }

  const env = getOptionalEnv();
  if (env.BYBIT_DEMO_API_KEY && env.BYBIT_DEMO_API_SECRET) {
    return { apiKey: env.BYBIT_DEMO_API_KEY, apiSecret: env.BYBIT_DEMO_API_SECRET, source: "env" };
  }

  return null;
}
