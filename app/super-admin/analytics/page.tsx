import PlatformAnalyticsClient from "./PlatformAnalyticsClient";

export const revalidate = 0;

// Access is gated by the super-admin layout (getSuperAdminUser); the client
// fetches the super-admin-only API which re-enforces authorization.
export default function SuperAdminAnalyticsPage() {
  return <PlatformAnalyticsClient />;
}
