import { createAdminClient } from "@/lib/supabase/server";

/**
 * Thin server-only wrapper around the `app_vault_get_secret` /
 * `app_vault_set_secret` RPCs (see supabase/migrations/*_vault_helpers.sql).
 * Never import this from client components. Never log the returned value.
 */
export async function getVaultSecret(name: string): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("app_vault_get_secret", { secret_name: name });
    if (error) return null;
    return (data as string | null) ?? null;
  } catch {
    // Vault may be unavailable/unsupported, or Supabase itself may not be
    // fully configured yet (e.g. SUPABASE_SECRET_KEY missing). Fail closed
    // to "not found" rather than throwing - callers fall back to the
    // environment variable.
    return null;
  }
}

export async function setVaultSecret(name: string, value: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("app_vault_set_secret", { secret_name: name, secret_value: value });
  if (error) {
    throw new Error(`Failed to store secret in Supabase Vault: ${error.message}`);
  }
}
