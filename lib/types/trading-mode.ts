export type TradingMode = "OBSERVE" | "PAPER" | "DEMO" | "LIVE";

/** LIVE is a recognized state but must never be reachable in this build. */
export const EXECUTABLE_MODES: readonly TradingMode[] = ["OBSERVE", "PAPER", "DEMO"];

export function isExecutableMode(mode: TradingMode): boolean {
  return EXECUTABLE_MODES.includes(mode);
}
