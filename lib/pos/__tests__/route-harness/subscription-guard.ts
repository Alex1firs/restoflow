// Test stub for @/lib/subscription-guard: the emulator restaurant is always
// considered to have an active subscription. `null` means "not blocked".
export async function checkSubscriptionAccess(_slug: string): Promise<null> {
  void _slug;
  return null;
}
