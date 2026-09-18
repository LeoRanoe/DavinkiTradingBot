import type { JeanfxStateTransition } from "@/lib/strategy/jeanfx-v1/types";

/**
 * Frequency diagnostics (brief S13): "For each London/New York session
 * track: liquidity sweeps, MSS/BOS, FVGs, retraces, confirmations, ready
 * setups, RR rejected, risk rejected, executed."
 *
 * This is pure aggregation over data the state machine already produces
 * (`JeanfxWalkResult.transitions`, whose `reasonCode`s are read here, never
 * reinterpreted) plus counters `scan.ts` supplies for the two rejection
 * kinds that happen AFTER the state machine returns (RR-below-minimum in
 * sizing.ts, portfolio/session caps in scan.ts) - lib/strategy/jeanfx-v1/
 * is not modified or even aware this file exists.
 */
export type JeanfxGoldFunnelCounts = {
  liquiditySweeps: number;
  mssBos: number;
  fvgs: number;
  retraces: number;
  confirmations: number;
  readySetups: number;
  rrRejected: number;
  riskRejected: number;
  executed: number;
};

export function emptyFunnelCounts(): JeanfxGoldFunnelCounts {
  return { liquiditySweeps: 0, mssBos: 0, fvgs: 0, retraces: 0, confirmations: 0, readySetups: 0, rrRejected: 0, riskRejected: 0, executed: 0 };
}

/** Folds one direction's (LONG or SHORT) state-machine transitions for a single evaluation into a running funnel count - call once per direction per evaluated instant, then add outcome-side counts (rrRejected/riskRejected/executed) separately from scan.ts. */
export function accumulateTransitions(counts: JeanfxGoldFunnelCounts, transitions: JeanfxStateTransition[]): JeanfxGoldFunnelCounts {
  const next = { ...counts };
  for (const t of transitions) {
    switch (t.reasonCode) {
      case "LIQUIDITY_SWEPT":
        next.liquiditySweeps += 1;
        break;
      case "MSS_CONFIRMED":
        next.mssBos += 1;
        break;
      case "FVG_FORMED":
        next.fvgs += 1;
        break;
      case "RETRACED_INTO_FVG":
        next.retraces += 1;
        break;
      case "CONFIRMATION_CANDLE":
        next.confirmations += 1;
        break;
      default:
        break; // timeouts/invalidations/bias-only transitions are not funnel stages
    }
  }
  return next;
}

export function mergeFunnelCounts(a: JeanfxGoldFunnelCounts, b: Partial<JeanfxGoldFunnelCounts>): JeanfxGoldFunnelCounts {
  return {
    liquiditySweeps: a.liquiditySweeps + (b.liquiditySweeps ?? 0),
    mssBos: a.mssBos + (b.mssBos ?? 0),
    fvgs: a.fvgs + (b.fvgs ?? 0),
    retraces: a.retraces + (b.retraces ?? 0),
    confirmations: a.confirmations + (b.confirmations ?? 0),
    readySetups: a.readySetups + (b.readySetups ?? 0),
    rrRejected: a.rrRejected + (b.rrRejected ?? 0),
    riskRejected: a.riskRejected + (b.riskRejected ?? 0),
    executed: a.executed + (b.executed ?? 0),
  };
}
