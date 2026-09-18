import { runJeanfxDirection } from "@/lib/strategy/jeanfx-v1/state-machine";
import { JEANFX_V1_PARAMS } from "@/lib/strategy/jeanfx-v1/config";
import { classifySession, JEANFX_DEFAULT_SESSION_WINDOWS } from "@/lib/strategy/jeanfx-v1/primitives/sessions";
import type { CanonicalCandle, Direction, TradingSession } from "../types";
import { sizeGoldPosition } from "./sizing";
import { accumulateTransitions, emptyFunnelCounts, mergeFunnelCounts, type JeanfxGoldFunnelCounts } from "./diagnostics";
import { JEANFX_GOLD_ACTIVE_CONFIG, JEANFX_GOLD_RISK_LIMITS } from "./config";
import { GOLD_INSTRUMENT_ID } from "./instrument";
import type { JeanfxUserConfig } from "@/lib/strategy/jeanfx-v1/config";

/**
 * JeanFX Gold PAPER scan step - one evaluation instant, both directions.
 *
 * This is the ONLY place JeanFX Gold-specific policy (session gate on top
 * of the strategy's own optional session filter, riskPct cap, RR minimum,
 * maxTradesPerSession) is enforced OUTSIDE the immutable strategy core.
 * `runJeanfxDirection` (lib/strategy/jeanfx-v1/state-machine.ts) is called
 * completely unmodified, exactly as the crypto built-in wrapper calls it
 * (lib/strategy-platform/built-in/jeanfx-v1.ts) - this file is a second,
 * parallel wrapper for the Gold PAPER research path, not a fork of the
 * strategy.
 *
 * There is no field anywhere in this module's input/output that could
 * route a decision to LIVE - `GoldScanResult.intent` is always either
 * null or a PAPER trade proposal; nothing in this file, sizing.ts, or
 * paper-executor.ts has a "mode" parameter to flip (CLAUDE.md #1).
 */
export type GoldPaperTradeIntent = {
  direction: Direction;
  entry: number;
  stop: number;
  target: number;
  qty: number;
  rMultiple: number;
  riskAmount: number;
  session: TradingSession;
  reasonCodes: string[];
  featureSnapshot: unknown;
};

export type GoldScanResult = {
  /** null when no setup is READY, or a READY setup was rejected by Gold-specific policy (RR/risk/session-cap) - see `funnel` for why. */
  intent: GoldPaperTradeIntent | null;
  funnel: JeanfxGoldFunnelCounts;
};

export type GoldScanInput = {
  now: number;
  candlesByTimeframe: {
    bias: CanonicalCandle[]; // M30 (ACTIVE) or H1 (SELECTIVE) per userConfig.biasTimeframe
    structure: CanonicalCandle[]; // M15, fixed by the strategy version
    entry: CanonicalCandle[]; // M5, fixed by the strategy version
  };
  equity: number;
  /** Trades already opened by this assignment in the CURRENT session (LONDON or NEW_YORK) - the caller (the scan job, which owns persistence) tracks this across calls; this function never persists anything itself. */
  tradesAlreadyOpenedThisSession: number;
  userConfig?: JeanfxUserConfig;
};

/** True only during LONDON and/or NEW_YORK (brief: "Do not use crypto-style ALL-session behavior as the default") - the strategy's OWN optional sessionFilter (JEANFX_GOLD_ACTIVE_CONFIG.sessionFilter) still applies on top of this via runJeanfxDirection's userConfig plumbing; this is the outer Gold-specific gate that exists even if a caller ever passed sessionFilter: "ALL" by mistake. */
function isGoldActiveSession(nowMs: number): TradingSession | null {
  const sessions = classifySession(nowMs, JEANFX_DEFAULT_SESSION_WINDOWS);
  if (sessions.includes("LONDON")) return "LONDON";
  if (sessions.includes("NEW_YORK")) return "NEW_YORK";
  return null;
}

export function runGoldScan(input: GoldScanInput): GoldScanResult {
  const userConfig = input.userConfig ?? JEANFX_GOLD_ACTIVE_CONFIG;
  let funnel = emptyFunnelCounts();

  const activeSession = isGoldActiveSession(input.now);
  if (!activeSession) {
    return { intent: null, funnel }; // outside London/New York entirely - no evaluation attempted, consistent with brief S3's session gate
  }

  if (input.tradesAlreadyOpenedThisSession >= JEANFX_GOLD_RISK_LIMITS.maxTradesPerSession) {
    return { intent: null, funnel }; // session trade cap already reached (brief S9) - never evaluate past it
  }

  for (const direction of ["LONG", "SHORT"] as const) {
    const result = runJeanfxDirection(input.candlesByTimeframe.bias, input.candlesByTimeframe.structure, input.candlesByTimeframe.entry, direction, JEANFX_V1_PARAMS, userConfig);
    funnel = accumulateTransitions(funnel, result.transitions);

    if (result.state !== "READY" || !result.setup) continue;

    funnel = mergeFunnelCounts(funnel, { readySetups: 1 });

    const sizing = sizeGoldPosition({
      direction,
      entryPrice: result.setup.entry,
      stopPrice: result.setup.stop,
      targetPrice: result.setup.target.level,
      equity: input.equity,
      riskPct: JEANFX_GOLD_RISK_LIMITS.riskPctMax,
    });

    if (!sizing.ok) {
      funnel = mergeFunnelCounts(funnel, sizing.reason === "RR_BELOW_MINIMUM" ? { rrRejected: 1 } : { riskRejected: 1 });
      continue;
    }

    funnel = mergeFunnelCounts(funnel, { executed: 1 });
    return {
      intent: {
        direction,
        entry: result.setup.entry,
        stop: result.setup.stop,
        target: result.setup.target.level,
        qty: sizing.qty,
        rMultiple: sizing.rMultiple,
        riskAmount: sizing.riskAmount,
        session: activeSession,
        reasonCodes: result.transitions.map((t) => t.reasonCode),
        featureSnapshot: { sweep: result.setup.sweep, structureEvent: result.setup.structureEvent, fvg: result.setup.fvg, confirmation: result.setup.confirmation },
      },
      funnel,
    };
  }

  return { intent: null, funnel };
}

export { GOLD_INSTRUMENT_ID };
