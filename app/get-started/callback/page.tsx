import { Suspense } from "react";
import OnboardingCallbackClient from "./OnboardingCallbackClient";

export default function OnboardingCallbackPage() {
  return (
    <Suspense>
      <OnboardingCallbackClient />
    </Suspense>
  );
}
