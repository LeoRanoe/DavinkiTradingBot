import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Authenticated bridge for Supabase Cron.
 *
 * pg_net currently fails its direct Vercel HTTP/2 hop for this project. The
 * Edge runtime performs that hop reliably. A dedicated scanner password stays
 * in Supabase Vault; this function exchanges it for a short-lived JWT, so
 * Vercel never needs a Supabase service-role credential.
 */

/**
 * The two credential hops below call the project's OWN PostgREST and Auth
 * endpoints, and both were observed returning intermittent 504s - roughly
 * 70% of scan cycles were lost to a transient gateway timeout on one of
 * them, with the scan never running at all.
 *
 * Retrying these two hops is safe because both are pure reads: looking up a
 * secret and exchanging it for a token have no side effects, so a repeat
 * costs nothing and cannot double-execute anything. The upstream scan call
 * is deliberately NOT retried here - it is the side-effecting one, and
 * leaving it single-shot keeps two scans from ever overlapping.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts = 3,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      // 400ms, then 1200ms. Short enough to stay well inside the caller's
      // 60s budget, long enough for a brief gateway blip to clear.
      await new Promise((resolve) => setTimeout(resolve, attempt === 1 ? 400 : 1200));
    }

    try {
      const response = await fetch(url, init);
      // Only a server-side failure is worth retrying. A 4xx is a real
      // answer - misconfigured credentials, say - and repeating it would
      // just delay a correct error.
      if (response.status < 500) return response;
      lastError = new Error(`upstream responded ${response.status}`);
      if (attempt === attempts - 1) return response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("request failed");
}

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

    const secretResponse = await fetchWithRetry(`${supabaseUrl}/rest/v1/rpc/get_davinki_scanner_credentials`, {
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

    const tokenResponse = await fetchWithRetry(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anonKey, "content-type": "application/json" },
      body: JSON.stringify(credentials),
    });
    if (!tokenResponse.ok) {
      return Response.json({ error: "Scanner sign-in failed", status: tokenResponse.status }, { status: 502 });
    }
    const tokenBody = await tokenResponse.json() as {
      access_token?: string;
      user?: { app_metadata?: { role?: string } };
    };
    if (!tokenBody.access_token) {
      return Response.json({ error: "Scanner token was not issued" }, { status: 502 });
    }

    // Single-shot on purpose: this is the side-effecting call.
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
    if (upstream.status === 401) {
      return Response.json(
        { error: "Scanner token was rejected upstream", role: tokenBody.user?.app_metadata?.role ?? null },
        { status: 502 },
      );
    }
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
