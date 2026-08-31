import "server-only";

/**
 * Every environment variable the Dispatcher integration needs, in one place,
 * with an explicit answer for "what happens when it is missing".
 *
 * The integration is OFF unless it is fully configured. A half-configured
 * integration that silently degrades is worse than one that is plainly
 * disabled: the first takes money for deliveries it cannot arrange.
 */

export type DeliveryConfig = {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  signingSecret: string;
  /** Secret Dispatcher signs its webhooks to us with. Separate from ours by design. */
  inboundSecret: string;
  /** Guards against pointing a dev build at a live logistics fleet. */
  environment: "development" | "staging" | "production";
};

export type ConfigResult =
  | { ok: true; config: DeliveryConfig }
  | { ok: false; missing: string[] };

export function readDeliveryConfig(env: NodeJS.ProcessEnv = process.env): ConfigResult {
  // The master switch. Absent or anything but "true" means the integration does
  // not exist as far as the rest of the app is concerned.
  if (env.DELIVERY_INTEGRATION_ENABLED !== "true") {
    return {
      ok: true,
      config: { enabled: false, baseUrl: "", apiKey: "", signingSecret: "", inboundSecret: "", environment: "development" },
    };
  }

  const required = {
    DISPATCHER_API_BASE_URL: env.DISPATCHER_API_BASE_URL,
    DISPATCHER_API_KEY: env.DISPATCHER_API_KEY,
    DISPATCHER_SIGNING_SECRET: env.DISPATCHER_SIGNING_SECRET,
    DISPATCHER_WEBHOOK_SECRET: env.DISPATCHER_WEBHOOK_SECRET,
  };

  const missing = Object.entries(required).filter(([, v]) => !v || !v.trim()).map(([k]) => k);
  if (missing.length > 0) return { ok: false, missing };

  const environment = (env.DELIVERY_ENVIRONMENT ?? "development") as DeliveryConfig["environment"];

  return {
    ok: true,
    config: {
      enabled: true,
      baseUrl: required.DISPATCHER_API_BASE_URL!.trim(),
      apiKey: required.DISPATCHER_API_KEY!.trim(),
      signingSecret: required.DISPATCHER_SIGNING_SECRET!.trim(),
      inboundSecret: required.DISPATCHER_WEBHOOK_SECRET!.trim(),
      environment,
    },
  };
}
