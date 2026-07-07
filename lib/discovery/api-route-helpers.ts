// Server-only wiring for the discovery API routes. Kept out of api-handlers.ts
// so that module stays pure/tsx-testable. Builds an Admin-SDK-backed store
// (which bypasses the deny-all discovery rules) + a real clock.

import "server-only";
import { getAdminDb } from "../firebase-admin";
import { createFirestoreStore } from "./firestore-store";
import type { HandlerDeps } from "./api-handlers";

export function buildDiscoveryDeps(): HandlerDeps {
  return { store: createFirestoreStore(getAdminDb()), nowMs: Date.now() };
}
