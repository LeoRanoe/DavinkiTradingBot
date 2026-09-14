/**
 * Time-bounded PAPER research windows.
 *
 * A research window is the ONLY thing that lets a strategy version which is
 * still DRAFT execute in PAPER. It is deliberately a separate concept from
 * the strategy's formal validation status (`strategy_versions.status`):
 *
 *   - `status` answers "has this strategy earned a promotion?" - it is
 *     evidence-based, owner-granted, and changes rarely.
 *   - a research window answers "is the owner currently collecting evidence
 *     about it?" - it is time-boxed, expires on its own, and implies nothing
 *     whatsoever about the strategy being validated or profitable.
 *
 * Running a research window must therefore never promote a strategy, and a
 * strategy must never become permanently executable because a window once
 * existed. See `isStrategyEligibleForPaper` in ./eligibility.ts.
 *
 * Everything here is pure: `now` is always passed in, never read from the
 * clock. The persisted row in `paper_research_sessions` is the authority -
 * there is no browser timer and no in-memory countdown, so a redeploy, a
 * cold start or a clock skew on one machine cannot extend or shorten a run.
 */

export type ResearchWindowStatus = "ACTIVE" | "EXPIRED" | "CANCELLED";

/** A persisted research session, normalized out of the database row. */
export type ResearchWindow = {
  id: string;
  startedAt: string;
  endsAt: string;
  /** Stored lifecycle status. May lag real time until a scan reconciles it. */
  status: ResearchWindowStatus;
  plannedDays: number;
  startingEquity: number;
  /** Informational milestone only. Never read by risk, sizing or filtering. */
  targetEquity: number | null;
  strategyVersionId: string | null;
  label: string | null;
  /** Set once, when the completion notification has actually been sent. */
  endedNotifiedAt: string | null;
};

/**
 * The window's state as of `nowMs`, which is what every caller must use.
 *
 * NOT_CONFIGURED - no session has ever been created.
 * SCHEDULED      - stored ACTIVE but has not started yet.
 * ACTIVE         - stored ACTIVE and now is inside [startedAt, endsAt).
 * EXPIRED        - the window elapsed, or was stored EXPIRED/CANCELLED.
 *
 * A stored status of ACTIVE is never trusted past `endsAt`: real time wins.
 * That is what makes expiry automatic rather than dependent on a job having
 * run - a missed or delayed scan can never keep AUTO alive past day 14.
 */
export type ResearchWindowState = "NOT_CONFIGURED" | "SCHEDULED" | "ACTIVE" | "EXPIRED";

export const RESEARCH_DEFAULT_DAYS = 14;

/**
 * Hard ceiling on a single research window. A run that cannot end on its own
 * is indistinguishable from permanently enabling automatic execution, which
 * is exactly what this feature exists to avoid. Mirrored by a CHECK
 * constraint in the migration so it holds even if this layer is bypassed.
 */
export const RESEARCH_MAX_DAYS = 30;

export const DAY_MS = 24 * 60 * 60 * 1000;

export function researchWindowState(
  window: ResearchWindow | null | undefined,
  nowMs: number,
): ResearchWindowState {
  if (!window) return "NOT_CONFIGURED";
  if (window.status !== "ACTIVE") return "EXPIRED";

  const startMs = Date.parse(window.startedAt);
  const endMs = Date.parse(window.endsAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "EXPIRED";

  if (nowMs < startMs) return "SCHEDULED";
  if (nowMs >= endMs) return "EXPIRED";
  return "ACTIVE";
}

export function isResearchWindowActive(
  window: ResearchWindow | null | undefined,
  nowMs: number,
): boolean {
  return researchWindowState(window, nowMs) === "ACTIVE";
}

/**
 * True when the stored row still says ACTIVE but the window has actually
 * elapsed - i.e. this is the scan that must reconcile it and notify once.
 */
export function needsExpiryReconciliation(
  window: ResearchWindow | null | undefined,
  nowMs: number,
): boolean {
  if (!window) return false;
  return window.status === "ACTIVE" && researchWindowState(window, nowMs) === "EXPIRED";
}

export type ResearchProgress = {
  /** 1-based day number, clamped to [1, totalDays]. "Day 3 of 14". */
  day: number;
  totalDays: number;
  msRemaining: number;
  /** Whole days remaining, rounded up, floored at 0. */
  daysRemaining: number;
};

/**
 * Human-facing progress through the window. Presentation only - no risk,
 * sizing or filtering decision may read this.
 */
export function researchProgress(window: ResearchWindow, nowMs: number): ResearchProgress {
  const startMs = Date.parse(window.startedAt);
  const endMs = Date.parse(window.endsAt);
  const totalMs = Math.max(1, endMs - startMs);
  const totalDays = Math.max(1, Math.round(totalMs / DAY_MS));

  const elapsedMs = Math.min(Math.max(0, nowMs - startMs), totalMs);
  const day = Math.min(totalDays, Math.floor(elapsedMs / DAY_MS) + 1);
  const msRemaining = Math.max(0, endMs - nowMs);

  return {
    day,
    totalDays,
    msRemaining,
    daysRemaining: Math.ceil(msRemaining / DAY_MS),
  };
}

/** "Day 3 of 14" - the one phrasing used across Telegram, dashboard and UI. */
export function formatResearchDay(window: ResearchWindow, nowMs: number): string {
  const { day, totalDays } = researchProgress(window, nowMs);
  return `Day ${day} of ${totalDays}`;
}

/** "6 days 4 hours" / "3 hours 12 minutes" / "under a minute". */
export function formatTimeRemaining(msRemaining: number): string {
  if (msRemaining <= 0) return "ended";
  const minutes = Math.floor(msRemaining / 60_000);
  if (minutes < 1) return "under a minute";

  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  const mins = minutes % 60;

  if (days > 0) return `${days} day${days === 1 ? "" : "s"} ${hours} hour${hours === 1 ? "" : "s"}`;
  if (hours > 0) return `${hours} hour${hours === 1 ? "" : "s"} ${mins} minute${mins === 1 ? "" : "s"}`;
  return `${mins} minute${mins === 1 ? "" : "s"}`;
}

export type StartWindowInput = {
  startedAtMs: number;
  days: number;
  startingEquity: number;
  targetEquity?: number | null;
  strategyVersionId?: string | null;
  label?: string | null;
};

export type StartWindowResult =
  | { ok: true; startedAt: string; endsAt: string; plannedDays: number }
  | { ok: false; reason: string };

/**
 * Validates and computes the bounds of a new window. Duration is checked
 * here AND by a database CHECK constraint - a window that cannot expire is
 * the single most dangerous state this feature could reach, so it is
 * rejected at both layers rather than either alone.
 */
export function planResearchWindow(input: StartWindowInput): StartWindowResult {
  const { days, startedAtMs, startingEquity } = input;

  if (!Number.isFinite(days) || days <= 0) {
    return { ok: false, reason: "Research duration must be a positive number of days." };
  }
  if (days > RESEARCH_MAX_DAYS) {
    return {
      ok: false,
      reason: `Research duration may not exceed ${RESEARCH_MAX_DAYS} days; a window that never ends is indistinguishable from permanently automatic execution.`,
    };
  }
  if (!Number.isFinite(startedAtMs)) {
    return { ok: false, reason: "Research start time is not a valid timestamp." };
  }
  if (!Number.isFinite(startingEquity) || startingEquity <= 0) {
    return { ok: false, reason: "Starting PAPER equity must be greater than zero." };
  }

  return {
    ok: true,
    startedAt: new Date(startedAtMs).toISOString(),
    endsAt: new Date(startedAtMs + days * DAY_MS).toISOString(),
    plannedDays: days,
  };
}

type ResearchSessionRowLike = {
  id: string;
  started_at: string;
  ends_at: string;
  status?: string | null;
  planned_days?: number | string | null;
  starting_equity?: number | string | null;
  target_equity?: number | string | null;
  strategy_version_id?: string | null;
  label?: string | null;
  ended_notified_at?: string | null;
};

function numOr(value: number | string | null | undefined, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Normalizes a `paper_research_sessions` row. An unrecognized status is
 * treated as EXPIRED rather than ACTIVE: unknown state must never be the
 * state that permits automatic execution.
 */
export function researchWindowFromRow(
  row: ResearchSessionRowLike | null | undefined,
): ResearchWindow | null {
  if (!row) return null;

  const status: ResearchWindowStatus =
    row.status === "ACTIVE" ? "ACTIVE" : row.status === "CANCELLED" ? "CANCELLED" : "EXPIRED";

  const startMs = Date.parse(row.started_at);
  const endMs = Date.parse(row.ends_at);
  const plannedDays = numOr(
    row.planned_days,
    Number.isFinite(startMs) && Number.isFinite(endMs)
      ? Math.max(1, Math.round((endMs - startMs) / DAY_MS))
      : RESEARCH_DEFAULT_DAYS,
  );

  const targetRaw = row.target_equity;
  const targetEquity =
    targetRaw === null || targetRaw === undefined ? null : numOr(targetRaw, Number.NaN);

  return {
    id: row.id,
    startedAt: row.started_at,
    endsAt: row.ends_at,
    status,
    plannedDays,
    startingEquity: numOr(row.starting_equity, 0),
    targetEquity: Number.isFinite(targetEquity as number) ? (targetEquity as number) : null,
    strategyVersionId: row.strategy_version_id ?? null,
    label: row.label ?? null,
    endedNotifiedAt: row.ended_notified_at ?? null,
  };
}
