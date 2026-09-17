import type { StrategyAssignmentMode, StrategyDefinitionType, StrategyVisibility } from "./types";

/**
 * Pure application-layer mirror of the RLS policies in
 * supabase/migrations/*_strategy_platform.sql. This is defense in depth,
 * the same pattern CLAUDE.md already uses for the risk engine mirroring DB
 * CHECK constraints: RLS is the actual enforcement boundary, these
 * functions let API routes (and tests, since this repo's test suite does
 * not run against live Postgres) apply and verify the identical rule set
 * deterministically. Keep both in sync - see the architecture doc.
 */

export type Role = "owner" | "guest" | "scanner";

export type Viewer = { userId: string; role: Role };

export type StrategyDefinitionRow = {
  id: string;
  type: StrategyDefinitionType;
  ownerUserId: string | null;
  visibility: StrategyVisibility;
};

export type StrategyPlatformVersionRow = {
  id: string;
  strategyDefinitionId: string;
  versionNumber: number;
  versionLabel: string;
  engineSchemaVersion: string;
  definition: unknown;
  status: string;
  createdAt: string;
  createdBy: string;
};

export type StrategyConfigurationRow = { id: string; userId: string };

export type StrategyAssignmentRow = {
  id: string;
  userId: string;
  mode: StrategyAssignmentMode;
  paperAuthorizedBy: string | null;
};

export const DEFAULT_ASSIGNMENT_MODE: StrategyAssignmentMode = "RESEARCH";

/** Mirrors: type = 'BUILT_IN' OR visibility = 'PUBLIC' OR owner_user_id = auth.uid(). */
export function canReadDefinition(viewer: Viewer, def: StrategyDefinitionRow): boolean {
  return def.type === "BUILT_IN" || def.visibility === "PUBLIC" || def.ownerUserId === viewer.userId;
}

/** Mirrors: role <> 'guest' AND type = 'USER_DEFINED' AND owner_user_id = auth.uid(). Built-ins are never client-mutable. */
export function canMutateDefinition(viewer: Viewer, def: StrategyDefinitionRow): boolean {
  return viewer.role !== "guest" && def.type === "USER_DEFINED" && def.ownerUserId === viewer.userId;
}

/** Creating a new version of an existing definition requires the same ownership as mutating it. */
export function canCreateVersion(viewer: Viewer, def: StrategyDefinitionRow): boolean {
  return canMutateDefinition(viewer, def);
}

export function canReadVersion(viewer: Viewer, def: StrategyDefinitionRow): boolean {
  return canReadDefinition(viewer, def);
}

/**
 * Mirrors the strategy_platform_versions_immutable trigger: only `status`
 * and `archivedAt` may ever change once a version row exists. Everything
 * else - including the definition snapshot itself - is permanently frozen.
 */
export function assertVersionMutationAllowed(
  oldRow: StrategyPlatformVersionRow,
  newRow: StrategyPlatformVersionRow,
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const immutableFields: (keyof StrategyPlatformVersionRow)[] = [
    "strategyDefinitionId",
    "versionNumber",
    "versionLabel",
    "engineSchemaVersion",
    "definition",
    "createdAt",
    "createdBy",
  ];
  for (const field of immutableFields) {
    if (JSON.stringify(oldRow[field]) !== JSON.stringify(newRow[field])) {
      errors.push(`field '${field}' is immutable on a strategy version`);
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/** Configurations and assignments are always private per-user rows - simple ownership, never shared. */
export function canMutateConfiguration(viewer: Viewer, config: StrategyConfigurationRow): boolean {
  return viewer.role !== "guest" && config.userId === viewer.userId;
}

export function canMutateAssignment(viewer: Viewer, assignment: StrategyAssignmentRow): boolean {
  return viewer.role !== "guest" && assignment.userId === viewer.userId;
}

export function canAuthorizePaperMode(viewer: Viewer): boolean {
  return viewer.role === "owner";
}

/**
 * The single choke point for changing an assignment's execution mode.
 * LIVE has no path through this function under any viewer/role - it is
 * refused unconditionally, mirroring CLAUDE.md's LIVE-disabled invariant
 * one layer up from the DB CHECK constraint. PAPER requires the assignment
 * to already carry (or this call to supply) an owner's authorization.
 */
export function canSetAssignmentMode(
  viewer: Viewer,
  assignment: StrategyAssignmentRow,
  requestedMode: StrategyAssignmentMode,
): { ok: true } | { ok: false; reason: string } {
  if (requestedMode === "LIVE") {
    return { ok: false, reason: "LIVE execution is never authorized through strategy assignments in this build" };
  }
  if (!canMutateAssignment(viewer, assignment)) {
    return { ok: false, reason: "viewer is not authorized to mutate this assignment" };
  }
  if (requestedMode === "PAPER" && !assignment.paperAuthorizedBy && !canAuthorizePaperMode(viewer)) {
    return { ok: false, reason: "PAPER mode requires owner authorization" };
  }
  return { ok: true };
}
