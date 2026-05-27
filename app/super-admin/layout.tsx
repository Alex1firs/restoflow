import { getSuperAdminUser } from "@/lib/auth-server";
import SuperAdminNav from "./components/SuperAdminNav";

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  await getSuperAdminUser();
  return (
    <div className="min-h-screen bg-gray-50 lg:flex">
      <SuperAdminNav />
      <main className="flex-1 min-w-0 pt-14 lg:pt-0">
        <div className="max-w-6xl mx-auto px-4 py-8 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  );
}
