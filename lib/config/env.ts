import { z } from "zod";

/**
 * Server-side environment schema.
 *
 * Tiers:
 *  - core: the two PUBLIC Supabase values. Required for literally anything
 *    in the app to work (even an RLS-respecting, anon-key read), so getEnv()
 *    throws if these are missing.
 *  - admin: SUPABASE_SECRET_KEY. Required only for privileged, service-role
 *    operations (cron writes, Vault, connection-settings writes) - kept
 *    OUT of the core schema so ordinary authenticated dashboard pages (which
 *    only ever need the public/anon client) keep working even before this
 *    is configured. See getSupabaseSecretKey() / createAdminClient().
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
});

// Env vars left blank (e.g. `QWEN_BASE_URL=` in .env.local, or an empty
// Vercel env var) arrive as an empty string, not undefined. Without this,
// `.optional()` would NOT treat "" as absent and `.url()`/`.min(1)` would
// reject it, throwing out of getEnv() for a var that is simply unset.
const blankToUndefined = (val: unknown) => (val === "" ? undefined : val);
const optionalString = () => z.preprocess(blankToUndefined, z.string().min(1).optional());
const optionalUrl = () => z.preprocess(blankToUndefined, z.string().url().optional());

const optionalSchema = z.object({
  CRON_SECRET: z.preprocess(blankToUndefined, z.string().min(16).optional()),
  QWEN_API_KEY: optionalString(),
  // Backward-compatible alias used by the existing Vercel project.
  QWEN_SECRET: optionalString(),
  QWEN_BASE_URL: optionalUrl(),
  QWEN_MODEL: optionalString(),
  TELEGRAM_BOT_TOKEN: optionalString(),
  TELEGRAM_OWNER_USER_ID: optionalString(),
  TELEGRAM_CHAT_ID: optionalString(),
  TELEGRAM_WEBHOOK_SECRET: optionalString(),
  BYBIT_DEMO_API_KEY: optionalString(),
  BYBIT_DEMO_API_SECRET: optionalString(),
});

const fullSchema = coreSchema.merge(optionalSchema);

export type Env = z.infer<typeof fullSchema>;

let cached: Env | null = null;

/**
 * Parses and validates process.env once per server process.
 * Throws only when the PUBLIC Supabase variables are missing/invalid -
 * SUPABASE_SECRET_KEY and every optional integration degrade gracefully
 * instead (see getSupabaseSecretKey() and the integration status helpers).
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

/**
 * The service-role secret key, required only for privileged server-side
 * operations (createAdminClient()). Deliberately NOT part of getEnv()'s
 * core schema - callers that only need an RLS-respecting client must keep
 * working without it. Throws a specific, actionable error when accessed
 * without it configured, rather than a generic "app can't start" error.
 */
export function getSupabaseSecretKey(): string {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not configured. This operation requires privileged (service-role) " +
        "Supabase access; ordinary authenticated reads do not. Set SUPABASE_SECRET_KEY in your " +
        "environment (Supabase Dashboard -> Project Settings -> API -> service_role key).",
    );
  }
  return key;
}

/**
 * Optional-integration env vars only - deliberately independent of the
 * Supabase core schema. Qwen/Telegram/Bybit Demo env fallback must work
 * even when SUPABASE_SECRET_KEY is missing/invalid; only Supabase-backed
 * (Vault) overrides need a working Supabase connection, and those already
 * fail closed to this fallback via getIntegrationRow()'s try/catch.
 */
export function getOptionalEnv() {
  return optionalSchema.parse(process.env);
}

/** Non-throwing variant for diagnostics / system status pages. */
export function getEnvStatus() {
  const result = fullSchema.safeParse(process.env);
  const optionalKeys = Object.keys(optionalSchema.shape) as Array<keyof typeof optionalSchema.shape>;
  const coreKeys = Object.keys(coreSchema.shape) as Array<keyof typeof coreSchema.shape>;

  const present = (key: string) => Boolean(process.env[key] && process.env[key]!.length > 0);

  return {
    core: Object.fromEntries(coreKeys.map((k) => [k, present(k)])),
    admin: { SUPABASE_SECRET_KEY: present("SUPABASE_SECRET_KEY") },
    optional: Object.fromEntries(optionalKeys.map((k) => [k, present(k)])),
    valid: result.success,
  };
}
