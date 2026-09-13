export type AppRole = "owner" | "guest";

type UserWithRole = { app_metadata?: Record<string, unknown> };

export function getUserRole(user: UserWithRole): AppRole {
  return user.app_metadata?.role === "owner" ? "owner" : "guest";
}

export function isOwner(user: UserWithRole): boolean {
  return getUserRole(user) === "owner";
}
