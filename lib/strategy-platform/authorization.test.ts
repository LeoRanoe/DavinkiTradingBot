import { describe, expect, it } from "vitest";
import {
  assertVersionMutationAllowed,
  canAuthorizePaperMode,
  canMutateAssignment,
  canMutateConfiguration,
  canMutateDefinition,
  canReadDefinition,
  canSetAssignmentMode,
  DEFAULT_ASSIGNMENT_MODE,
  type StrategyAssignmentRow,
  type StrategyDefinitionRow,
  type StrategyPlatformVersionRow,
} from "./authorization";

const owner = { userId: "user-owner", role: "owner" as const };
const userA = { userId: "user-a", role: "owner" as const }; // "owner" role today = the one non-guest account
const userB = { userId: "user-b", role: "owner" as const };
const guest = { userId: "user-guest", role: "guest" as const };

function builtIn(overrides: Partial<StrategyDefinitionRow> = {}): StrategyDefinitionRow {
  return { id: "def-builtin", type: "BUILT_IN", ownerUserId: null, visibility: "PRIVATE", ...overrides };
}
function userDefinedFor(userId: string, overrides: Partial<StrategyDefinitionRow> = {}): StrategyDefinitionRow {
  return { id: "def-custom", type: "USER_DEFINED", ownerUserId: userId, visibility: "PRIVATE", ...overrides };
}

describe("strategy definition read/mutate isolation", () => {
  it("any authenticated viewer can read a built-in definition", () => {
    expect(canReadDefinition(userA, builtIn())).toBe(true);
    expect(canReadDefinition(guest, builtIn())).toBe(true);
  });

  it("only the owning user can read their private custom strategy", () => {
    const def = userDefinedFor(userA.userId);
    expect(canReadDefinition(userA, def)).toBe(true);
    expect(canReadDefinition(userB, def)).toBe(false);
    expect(canReadDefinition(guest, def)).toBe(false);
  });

  it("a PUBLIC custom strategy is readable by anyone once that visibility is explicitly set", () => {
    const def = userDefinedFor(userA.userId, { visibility: "PUBLIC" });
    expect(canReadDefinition(userB, def)).toBe(true);
  });

  it("no one can mutate a built-in definition, including its nominal owner slot", () => {
    expect(canMutateDefinition(owner, builtIn())).toBe(false);
  });

  it("only the owning non-guest user can mutate their own custom strategy", () => {
    const def = userDefinedFor(userA.userId);
    expect(canMutateDefinition(userA, def)).toBe(true);
    expect(canMutateDefinition(userB, def)).toBe(false);
    expect(canMutateDefinition(guest, userDefinedFor(guest.userId))).toBe(false);
  });
});

describe("strategy version immutability", () => {
  function version(overrides: Partial<StrategyPlatformVersionRow> = {}): StrategyPlatformVersionRow {
    return {
      id: "ver-1",
      strategyDefinitionId: "def-1",
      versionNumber: 1,
      versionLabel: "v1",
      engineSchemaVersion: "1",
      definition: { entry: { type: "ALL", children: [] } },
      status: "DRAFT",
      createdAt: "2026-01-01T00:00:00Z",
      createdBy: "user-a",
      ...overrides,
    };
  }

  it("allows a status/archivedAt-only change", () => {
    const oldRow = version();
    const newRow = version({ status: "RESEARCH_ONLY" });
    expect(assertVersionMutationAllowed(oldRow, newRow)).toEqual({ ok: true });
  });

  it("rejects any change to the definition snapshot", () => {
    const oldRow = version();
    const newRow = version({ definition: { entry: { type: "ANY", children: [] } } });
    const result = assertVersionMutationAllowed(oldRow, newRow);
    expect(result.ok).toBe(false);
  });

  it("rejects changing which strategy definition a version belongs to", () => {
    const oldRow = version();
    const newRow = version({ strategyDefinitionId: "def-2" });
    expect(assertVersionMutationAllowed(oldRow, newRow).ok).toBe(false);
  });
});

describe("configuration and assignment ownership isolation", () => {
  it("a user cannot mutate another user's configuration", () => {
    expect(canMutateConfiguration(userA, { id: "cfg-1", userId: userB.userId })).toBe(false);
    expect(canMutateConfiguration(userA, { id: "cfg-1", userId: userA.userId })).toBe(true);
  });

  it("guests can never mutate configurations or assignments even if they own the row", () => {
    expect(canMutateConfiguration(guest, { id: "cfg-1", userId: guest.userId })).toBe(false);
    expect(canMutateAssignment(guest, { id: "a-1", userId: guest.userId, mode: "RESEARCH", paperAuthorizedBy: null })).toBe(
      false,
    );
  });

  it("a user cannot mutate another user's assignment", () => {
    const assignment: StrategyAssignmentRow = { id: "a-1", userId: userB.userId, mode: "RESEARCH", paperAuthorizedBy: null };
    expect(canMutateAssignment(userA, assignment)).toBe(false);
  });
});

describe("execution mode authorization - no path to LIVE, PAPER requires owner", () => {
  it("new strategy assignments default to RESEARCH, never PAPER/LIVE", () => {
    expect(DEFAULT_ASSIGNMENT_MODE).toBe("RESEARCH");
  });

  it("LIVE is refused unconditionally, for every role including owner", () => {
    const assignment: StrategyAssignmentRow = { id: "a-1", userId: owner.userId, mode: "RESEARCH", paperAuthorizedBy: null };
    expect(canSetAssignmentMode(owner, assignment, "LIVE")).toEqual({
      ok: false,
      reason: expect.stringContaining("LIVE"),
    });
    expect(canSetAssignmentMode(userA, assignment, "LIVE").ok).toBe(false);
  });

  it("there is no sequence of custom-strategy-creation calls that yields LIVE", () => {
    // Creating a custom strategy only ever grants canMutateDefinition/canCreateVersion
    // for USER_DEFINED rows - neither function, nor canSetAssignmentMode, has any
    // branch that returns ok:true for mode 'LIVE' regardless of viewer/ownership.
    const def = userDefinedFor(userA.userId);
    expect(canMutateDefinition(userA, def)).toBe(true);
    const assignment: StrategyAssignmentRow = { id: "a-1", userId: userA.userId, mode: "RESEARCH", paperAuthorizedBy: null };
    expect(canSetAssignmentMode(userA, assignment, "LIVE").ok).toBe(false);
  });

  it("a non-owner role cannot self-authorize PAPER even when it owns the row", () => {
    // "owner" is the only non-guest role in this single-owner app today (see
    // supabase/migrations/20260913111342_owner_guest_access.sql), so this
    // uses the other real, distinct role ("scanner") to exercise the branch
    // that matters for a future second non-owner role.
    const nonOwnerViewer = { userId: "user-a", role: "scanner" as const };
    const assignment: StrategyAssignmentRow = { id: "a-1", userId: "user-a", mode: "RESEARCH", paperAuthorizedBy: null };
    expect(canSetAssignmentMode(nonOwnerViewer, assignment, "PAPER")).toEqual({
      ok: false,
      reason: expect.stringContaining("owner"),
    });
  });

  it("the owner role can authorize PAPER on its own assignment", () => {
    const assignment: StrategyAssignmentRow = { id: "a-1", userId: owner.userId, mode: "RESEARCH", paperAuthorizedBy: null };
    expect(canSetAssignmentMode(owner, assignment, "PAPER")).toEqual({ ok: true });
    expect(canAuthorizePaperMode(owner)).toBe(true);
    expect(canAuthorizePaperMode(guest)).toBe(false);
  });

  it("once already authorized, the owning user can keep PAPER without re-authorization", () => {
    const assignment: StrategyAssignmentRow = { id: "a-1", userId: owner.userId, mode: "PAPER", paperAuthorizedBy: owner.userId };
    expect(canSetAssignmentMode(owner, assignment, "PAPER")).toEqual({ ok: true });
  });
});
