import { Suspense } from "react";
import AuthActionClient from "./AuthActionClient";

export default function AuthActionPage() {
  return (
    <Suspense>
      <AuthActionClient />
    </Suspense>
  );
}
