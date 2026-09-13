import { z } from "zod";

/**
 * Server-side environment schema.
 *
 * Tiers:
 *  - core: required for the app to boot at all (Supabase connection).
 *  - qwen / telegram / demo: optional integrations. Their absence must not
 *    crash the app — see lib/config/*.ts "getXConfiguration()" helpers which
 *    layer Supabase Vault overrides on top of these env fallbacks.
 *
 * Never log the parsed values. Never send raw env vars to the client -
 * only NEXT_PUBLIC_* vars are safe for the browser.
 */
const coreSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
});

const optionalSchema = z.object({
  CRON_SECRET: z.string().min(16).optional(),
  QWEN_API_KEY: z.string().min(1).optional(),
  QWEN_BASE_URL: z.string().url().optional(),
  QWEN_MODEL: z.string().min(1).optional(),
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_OWNER_USER_ID: z.string().min(1).optional(),
  TELEGRAM_CHAT_ID: z.string().min(1).optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1).optional(),
  BYBIT_DEMO_API_KEY: z.string().min(1).optional(),
  BYBIT_DEMO_API_SECRET: z.string().min(1).optional(),
});

const fullSchema = coreSchema.merge(optionalSchema);

export type Env = z.infer<typeof fullSchema>;

let cached: Env | null = null;

/**
 * Parses and validates process.env once per server process.
 * Throws only when CORE variables are missing/invalid - optional
 * integrations degrade gracefully instead (see integration status helpers).
 */
export function getEnv(): Env {
  if (cached) return cached;

  const coreResult = coreSchema.safeParse(process.env);
  if (!coreResult.success) {
    const missing = coreResult.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(
      `Missing/invalid core environment variables: ${missing}. The application cannot start without Supabase configuration.`,
    );
  }

  const full = fullSchema.parse(process.env);
  cached = full;
  return full;
}

/** Non-throwing variant for diagnostics / system status pages. */
export function getEnvStatus() {
  const result = fullSchema.safeParse(process.env);
  const optionalKeys = Object.keys(optionalSchema.shape) as Array<keyof typeof optionalSchema.shape>;
  const coreKeys = Object.keys(coreSchema.shape) as Array<keyof typeof coreSchema.shape>;

  const present = (key: string) => Boolean(process.env[key] && process.env[key]!.length > 0);

  return {
    core: Object.fromEntries(coreKeys.map((k) => [k, present(k)])),
    optional: Object.fromEntries(optionalKeys.map((k) => [k, present(k)])),
    valid: result.success,
  };
}
