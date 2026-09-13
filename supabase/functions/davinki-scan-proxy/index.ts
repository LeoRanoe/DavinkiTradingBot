import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Authenticated bridge for Supabase Cron.
 *
 * pg_net currently fails its direct Vercel HTTP/2 hop for this project. The
 * Edge runtime performs that hop reliably. A dedicated scanner password stays
 * in Supabase Vault; this function exchanges it for a short-lived JWT, so
 * Vercel never needs a Supabase service-role credential.
 */
Deno.serve(async (request: Request) => {
  try {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return Response.json({ error: "Automatic Supabase environment is unavailable" }, { status: 500 });
    }

    const secretResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/get_davinki_scanner_credentials`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    if (!secretResponse.ok) {
      return Response.json(
        { error: "Scanner credential lookup failed", status: secretResponse.status },
        { status: 502 },
      );
    }

    const credentials: unknown = await secretResponse.json();
    if (
      !credentials || typeof credentials !== "object" ||
      typeof (credentials as Record<string, unknown>).email !== "string" ||
      typeof (credentials as Record<string, unknown>).password !== "string"
    ) {
      return Response.json({ error: "Scanner credentials are not configured" }, { status: 500 });
    }

    const tokenResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anonKey, "content-type": "application/json" },
      body: JSON.stringify(credentials),
    });
    if (!tokenResponse.ok) {
      return Response.json({ error: "Scanner sign-in failed", status: tokenResponse.status }, { status: 502 });
    }
    const tokenBody = await tokenResponse.json() as { access_token?: string };
    if (!tokenBody.access_token) {
      return Response.json({ error: "Scanner token was not issued" }, { status: 502 });
    }

    const upstream = await fetch("https://davinki-trading-bot.vercel.app/api/jobs/scan", {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokenBody.access_token}`,
        "content-type": "application/json",
        "user-agent": "davinki-supabase-scan-proxy/1.0",
      },
      body: "{}",
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  } catch (error) {
    return Response.json(
      { error: "Scanner proxy failed", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
});
