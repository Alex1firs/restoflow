import { getSuperAdminUser } from "@/lib/auth-server";
import SuperAdminNav from "./components/SuperAdminNav";

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  await getSuperAdminUser();
  return (
    <div className="min-h-screen bg-gray-50">
      <SuperAdminNav />
      <main className="max-w-7xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
