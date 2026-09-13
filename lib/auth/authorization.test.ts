import { describe, expect, it } from "vitest";
import { getUserRole, isOwner } from "./authorization";

describe("application authorization roles", () => {
  it("recognizes only server-managed owner metadata as owner access", () => {
    const user = { app_metadata: { role: "owner" } };
    expect(getUserRole(user)).toBe("owner");
    expect(isOwner(user)).toBe(true);
  });

  it("fails closed to guest for missing or unexpected metadata", () => {
    expect(getUserRole({})).toBe("guest");
    expect(getUserRole({ app_metadata: { role: "admin" } })).toBe("guest");
    expect(isOwner({ app_metadata: { role: "guest" } })).toBe(false);
  });
});
