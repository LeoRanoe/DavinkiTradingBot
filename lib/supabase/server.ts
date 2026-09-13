import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "./database.types";
import { getEnv } from "@/lib/config/env";

/**
 * Server Component / Route Handler Supabase client, scoped to the signed-in
 * user via cookies. Respects RLS - use this for all user-facing reads.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const env = getEnv();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component without a mutable response;
            // safe to ignore if middleware refreshes the session.
          }
        },
      },
    },
  );
}

/**
 * Privileged server-only client using the Supabase secret key. Bypasses RLS.
 * NEVER import this from client components or expose the key to the browser.
 * Use only for: cron jobs, webhook handlers, and trusted server mutations
 * (signal creation, order placement, audit logging).
 */
export function createAdminClient() {
  const env = getEnv();
  return createSupabaseClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
