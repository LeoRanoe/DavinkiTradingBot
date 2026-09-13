import { createAdminClient } from "@/lib/supabase/server";

/**
 * Thin server-only wrapper around the `app_vault_get_secret` /
 * `app_vault_set_secret` RPCs (see supabase/migrations/*_vault_helpers.sql).
 * Never import this from client components. Never log the returned value.
 */
export async function getVaultSecret(name: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("app_vault_get_secret", { secret_name: name });
  if (error) {
    // Vault may be unavailable/unsupported in some project configurations.
    // Fail closed to "not found" rather than throwing - callers fall back
    // to the environment variable.
    return null;
  }
  return (data as string | null) ?? null;
}

export async function setVaultSecret(name: string, value: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("app_vault_set_secret", { secret_name: name, secret_value: value });
  if (error) {
    throw new Error(`Failed to store secret in Supabase Vault: ${error.message}`);
  }
}
