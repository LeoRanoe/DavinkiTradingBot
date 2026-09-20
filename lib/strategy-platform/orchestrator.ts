import { checkStrategyCompatibility } from "./compatibility";
import { applyPortfolioRisk, NO_CORRELATION_MODELING, type CorrelationPolicy, type PortfolioLimits, type RejectedOpportunity } from "./portfolio-risk";
import { resolveConflicts, type ConflictPolicy, type ConflictResolutionResult } from "./conflict";
import { buildEvaluationPlan, distributeMarketData, loadMarketData, resolveTimeframesFor } from "./evaluation-plan";
import type { AssignmentInput, MarketDataProvider, PortfolioState, VenueCapabilities } from "./orchestrator-types";
import type { EvaluationError, Instrument, Opportunity, ScanObservability, StrategyContext, TradingSession } from "./types";

/**
 * The generic strategy orchestrator (Prompt 3 S1/S2).
 *
 * Pipeline, in this exact order, matching the brief:
 *   assignments x instruments -> evaluations -> opportunities
 *     -> policy filtering (compatibility)
 *     -> risk (portfolio limits, same-instrument aggregation)
 *     -> conflict resolution (opposing directions)
 *     -> [caller's execution selection/execution - OUT OF SCOPE here]
 *
 * This module NEVER executes anything - it has no order-placement call
 * anywhere in it, by construction. It collects every opportunity first,
 * then runs risk and conflict resolution over the whole collected set -
 * there is no "iterate and execute as we go" path to accidentally take.
 *
 * Ordering independence: every grouping/sorting step in the modules this
 * composes (evaluation-plan, portfolio-risk, conflict) sorts its own keys,
 * so shuffling `input.assignments` or `input.instruments` never changes
 * the result - see orchestrator.test.ts / orchestrator.e2e.test.ts.
 *
 * Failure isolation (Prompt 3 S30): each (assignment, instrument)
 * evaluation is wrapped individually. One broken custom strategy raises an
 * EvaluationError scoped to that cell and is skipped - every other
 * assignment (JeanFX, TRB, other users, other instruments) still runs.
 */

export type OrchestratorInput = {
  now: number;
  assignments: AssignmentInput[];
  instruments: Record<string, Instrument>;
  venue: VenueCapabilities;
  marketDataProvider: MarketDataProvider;
  portfolio: PortfolioState;
  limits: PortfolioLimits;
  /** How much of equity an opportunity would consume if executed - supplied by the caller, which owns real risk configuration (lib/risk/). */
  riskPctOf: (o: Opportunity) => number;
  conflictPolicy?: ConflictPolicy;
  correlation?: CorrelationPolicy;
  marketSessionOf?: (ms: number) => TradingSession[] | null;
};

export type IncompatibleAssignment = { assignmentId: string; strategyDefinitionId: string; instrumentId: string; reasons: string[] };

export type OrchestratorResult = {
  /** Cleared for PAPER execution consideration after risk + conflict resolution. Still not guaranteed to execute - that decision belongs to the caller. */
  executable: Opportunity[];
  /** SHADOW-mode opportunities: fully evaluated against current markets, never executable. */
  shadowed: Opportunity[];
  /** RESEARCH-mode opportunities, and any opportunity whose strategy/venue pairing can never execute (compatibility-blocked execution only, research still allowed). */
  researchOnly: Opportunity[];
  /** Opposing-direction conflicts, per conflict.ts - both sides preserved, never netted. */
  blocked: Opportunity[];
  riskRejected: RejectedOpportunity[];
  incompatible: IncompatibleAssignment[];
  errors: EvaluationError[];
  observability: ScanObservability;
};

function emptyObservability(): ScanObservability {
  return { assignmentsEvaluated: 0, strategyEvaluations: 0, instrumentsEvaluated: 0, opportunitiesGenerated: 0, conflicts: 0, riskRejected: 0, executed: 0, shadowed: 0, byStrategy: {}, errors: [] };
}

function touchStrategyStat(obs: ScanObservability, strategyDefinitionId: string) {
  if (!obs.byStrategy[strategyDefinitionId]) obs.byStrategy[strategyDefinitionId] = { evaluations: 0, opportunities: 0, errors: 0 };
  return obs.byStrategy[strategyDefinitionId];
}

export async function runOrchestrator(input: OrchestratorInput): Promise<OrchestratorResult> {
  const observability = emptyObservability();
  const incompatible: IncompatibleAssignment[] = [];
  const errors: EvaluationError[] = [];

  const researchOnly: Opportunity[] = [];
  const shadowed: Opportunity[] = [];
  const paperCandidates: Opportunity[] = [];

  const plan = buildEvaluationPlan(input.assignments);
  const loaded = await loadMarketData(plan, input.marketDataProvider);

  const evaluatedInstruments = new Set<string>();

  for (const assignment of [...input.assignments].sort((a, b) => a.assignmentId.localeCompare(b.assignmentId))) {
    observability.assignmentsEvaluated += 1;

    for (const instrumentId of [...assignment.instrumentIds].sort()) {
      evaluatedInstruments.add(instrumentId);
      const instrument = input.instruments[instrumentId];
      const stat = touchStrategyStat(observability, assignment.strategyDefinitionId);

      if (!instrument) {
        incompatible.push({ assignmentId: assignment.assignmentId, strategyDefinitionId: assignment.strategyDefinitionId, instrumentId, reasons: [`Unknown instrument '${instrumentId}'`] });
        continue;
      }

      const candlesByTimeframe = distributeMarketData(loaded, instrumentId, resolveTimeframesFor(assignment.strategy, assignment.parameters));
      const availableHistoryBars = Object.fromEntries(
        Object.entries(candlesByTimeframe).map(([tf, candles]) => [tf, (candles ?? []).filter((c) => c.isClosed).length]),
      );

      const requestedSide = (assignment.parameters.side as "LONG" | "SHORT" | undefined) ?? assignment.strategy.metadata.supportedSides[0];
      const compat = checkStrategyCompatibility({
        metadata: assignment.strategy.metadata,
        instrument,
        venue: input.venue,
        side: requestedSide,
        availableHistoryBars,
      });

      if (!compat.researchCompatible) {
        incompatible.push({ assignmentId: assignment.assignmentId, strategyDefinitionId: assignment.strategyDefinitionId, instrumentId, reasons: compat.reasons });
        continue;
      }

      let decision;
      try {
        const ctx: StrategyContext = {
          instrument,
          now: input.now,
          candlesByTimeframe,
          marketSession: input.marketSessionOf ? input.marketSessionOf(input.now) : null,
          currentPosition: null,
          strategyParameters: assignment.parameters,
        };
        observability.strategyEvaluations += 1;
        stat.evaluations += 1;
        decision = assignment.strategy.evaluate(ctx);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const evalError: EvaluationError = { strategyAssignmentId: assignment.assignmentId, strategyDefinitionId: assignment.strategyDefinitionId, instrumentId, message };
        errors.push(evalError);
        observability.errors.push(evalError);
        stat.errors += 1;
        continue; // failure isolation: this cell is skipped, every other assignment/instrument still runs
      }

      if (decision.type !== "ENTER_LONG" && decision.type !== "ENTER_SHORT") continue;

      const opportunity: Opportunity = {
        userId: assignment.userId,
        strategyDefinitionId: assignment.strategyDefinitionId,
        strategyVersionId: assignment.strategyVersionId,
        strategyConfigurationId: assignment.strategyConfigurationId,
        strategyAssignmentId: assignment.assignmentId,
        instrumentId,
        side: decision.type === "ENTER_LONG" ? "LONG" : "SHORT",
        signalTime: input.now,
        entry: decision.entry,
        stop: decision.stop,
        target: decision.target,
        partialExitPlan: decision.partialExitPlan,
        reasonCodes: decision.reasonCodes,
        parameterSnapshot: { ...assignment.parameters },
        featureSnapshot: decision.featureSnapshot,
        confidence: decision.confidence,
        priority: assignment.priority,
      };

      observability.opportunitiesGenerated += 1;
      stat.opportunities += 1;

      if (!compat.executionCompatible) {
        // Research-compatible but can never execute on this venue (e.g. SHORT on a long-only spot venue) - always research evidence, regardless of the assignment's own mode.
        researchOnly.push(opportunity);
        continue;
      }

      if (assignment.effectiveMode === "RESEARCH") researchOnly.push(opportunity);
      else if (assignment.effectiveMode === "SHADOW") shadowed.push(opportunity);
      else if (assignment.effectiveMode === "PAPER") paperCandidates.push(opportunity);
      else {
        // LIVE should be structurally unreachable (resolveEffectiveMode never authorizes it in this build) -
        // defense in depth: refuse it here too rather than trusting the caller completely.
        errors.push({ strategyAssignmentId: assignment.assignmentId, strategyDefinitionId: assignment.strategyDefinitionId, instrumentId, message: "LIVE effectiveMode reached the orchestrator - refused unconditionally." });
      }
    }
  }

  observability.instrumentsEvaluated = evaluatedInstruments.size;

  // Risk screening (Prompt 3 S4/S5) - only PAPER-track opportunities consume real portfolio risk.
  const riskResult = applyPortfolioRisk(paperCandidates, input.riskPctOf, (id) => input.instruments[id], input.portfolio, input.limits, input.correlation ?? NO_CORRELATION_MODELING);
  observability.riskRejected = riskResult.rejected.length;

  const survivingOpportunities = riskResult.intents.flatMap((i) => i.contributingOpportunities);

  // Conflict resolution (Prompt 3 S6) - opposing directions on what's left after risk screening.
  const conflictResults: ConflictResolutionResult[] = resolveConflicts(survivingOpportunities, input.conflictPolicy);
  const executable = conflictResults.flatMap((r) => r.executable);
  const blocked = conflictResults.flatMap((r) => r.blocked);
  observability.conflicts = conflictResults.filter((r) => r.blocked.length > 0).length;
  observability.executed = executable.length; // "executed" here means "cleared for execution consideration" - actual execution is the caller's job
  observability.shadowed = shadowed.length;

  return { executable, shadowed, researchOnly, blocked, riskRejected: riskResult.rejected, incompatible, errors, observability };
}
