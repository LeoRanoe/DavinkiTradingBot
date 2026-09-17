import { NextRequest, NextResponse } from "next/server";
import { getCandles } from "@/lib/bybit/client";
import { findCryptoInstrumentByVenueSymbol } from "@/lib/domain/instruments/crypto";
import type { CanonicalCandle } from "@/lib/domain/market-data-provider";

/**
 * TEMPORARY Checkpoint 3B.0B research data bridge. NOT part of the
 * production trading system - not imported by, and does not import,
 * app/api/jobs/scan/route.ts, lib/strategy/v1/, lib/trading/, or
 * lib/risk/. Exists ONLY so the research environment (which is
 * geo-blocked from api.bybit.com) can fetch one page of PUBLIC Bybit
 * Spot candle data through a Vercel Singapore (sin1) function, the same
 * region the production scanner already uses successfully.
 *
 * This is intentionally NOT a general HTTP proxy:
 *   - Exactly one upstream call shape (lib/bybit/client.ts's existing
 *     getCandles - never reimplemented here).
 *   - A closed allowlist of instruments/timeframes (the five Checkpoint
 *     3B study instruments x {1H, 4H} - nothing else).
 *   - Exactly four accepted query params, each validated.
 *   - No order placement, no private/account Bybit endpoints, no
 *     Supabase access (read or write), no strategy-signal evaluation.
 *
 * DELETE THIS FILE (and its vercel.json region entry) once Checkpoint
 * 3B.0B's historical data has been fetched and validated - see
 * research-results/v2-trb/README.md for the removal record.
 */

const ALLOWED_SYMBOLS = new Set(["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT"]);
const ALLOWED_TIMEFRAMES = new Set(["1H", "4H"] as const);
type AllowedTimeframe = "1H" | "4H";

function unauthorized(): NextResponse {
  // §4: absent/incorrect token -> no Bybit request is ever made. 404 (not
  // 401) so the route's very existence isn't advertised to an unauthenticated caller.
  return new NextResponse(null, { status: 404 });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const expectedToken = process.env.RESEARCH_BRIDGE_TOKEN;
  if (!expectedToken) return unauthorized();

  const authHeader = request.headers.get("authorization") ?? "";
  const presented = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  if (!presented || presented !== expectedToken) return unauthorized();

  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol");
  const timeframe = url.searchParams.get("timeframe");
  const endMsRaw = url.searchParams.get("endMs");
  const limitRaw = url.searchParams.get("limit");

  if (!symbol || !ALLOWED_SYMBOLS.has(symbol)) {
    return NextResponse.json({ error: "INVALID_SYMBOL", allowed: [...ALLOWED_SYMBOLS] }, { status: 400 });
  }
  if (!timeframe || !ALLOWED_TIMEFRAMES.has(timeframe as AllowedTimeframe)) {
    return NextResponse.json({ error: "INVALID_TIMEFRAME", allowed: [...ALLOWED_TIMEFRAMES] }, { status: 400 });
  }
  if (!limitRaw) {
    return NextResponse.json({ error: "MISSING_LIMIT" }, { status: 400 });
  }
  const limit = Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    return NextResponse.json({ error: "INVALID_LIMIT", mustBeIntegerBetween: [1, 1000] }, { status: 400 });
  }
  let endMs: number | undefined;
  if (endMsRaw !== null) {
    endMs = Number(endMsRaw);
    if (!Number.isFinite(endMs) || !Number.isInteger(endMs) || endMs <= 0) {
      return NextResponse.json({ error: "INVALID_END_MS" }, { status: 400 });
    }
  }

  const instrument = findCryptoInstrumentByVenueSymbol(symbol);
  if (!instrument) {
    // Should be unreachable given ALLOWED_SYMBOLS, but never fabricate an instrumentId.
    return NextResponse.json({ error: "INSTRUMENT_NOT_FOUND" }, { status: 500 });
  }

  try {
    const raw = await getCandles(symbol, timeframe as AllowedTimeframe, limit, endMs);
    const candles: CanonicalCandle[] = raw.map((c) => ({
      instrumentId: instrument.id,
      timeframe: timeframe as AllowedTimeframe,
      openTime: c.openTime,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      isClosed: c.isClosed,
    }));
    return NextResponse.json({
      symbol,
      timeframe,
      limit,
      endMs: endMs ?? null,
      region: process.env.VERCEL_REGION ?? null,
      candles,
    });
  } catch (err) {
    return NextResponse.json({ error: "UPSTREAM_BYBIT_ERROR", message: (err as Error).message }, { status: 502 });
  }
}
