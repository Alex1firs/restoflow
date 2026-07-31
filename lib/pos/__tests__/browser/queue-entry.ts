/**
 * Bundle entry for the two-tab queue-lease harness. Re-exports the REAL atomic
 * IndexedDB primitive and the REAL lease logic, so the browser test exercises
 * production code against production IndexedDB rather than a simulation.
 */
export { dbUpdateAtomic, dbPut, dbGetAll, dbDelete, openOfflineDB } from "../../../offline-db";
export {
  claimTransition,
  claimableRecords,
  completeTransition,
  failTransition,
  isStranded,
  newAttemptId,
  outstandingRecords,
  recoverTransition,
  syncOwnerId,
  LEASE_DURATION_MS,
} from "../../sync-lease";
