// Test stub for @/lib/auth-server. The real implementation reads a session
// cookie via next/headers and verifies it against Firebase Auth, neither of
// which exists outside a request. Everything AFTER authentication — validation,
// pricing, idempotency, the response — is the real route code.
export type UserRole = "owner" | "manager" | "staff" | "super_admin";
export type AuthenticatedUser = { uid: string; restaurantSlug: string; role: UserRole };

export const TEST_USER: AuthenticatedUser = {
  uid: "test-cashier-uid",
  restaurantSlug: "emulator-grills",
  role: "manager",
};

export async function getAuthenticatedUser(): Promise<AuthenticatedUser> {
  return TEST_USER;
}
export async function getSuperAdminUser(): Promise<AuthenticatedUser> {
  return TEST_USER;
}
