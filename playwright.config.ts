/**
 * Playwright config — POS browser tests ONLY.
 *
 * Dev-only. Nothing here ships: `@playwright/test` is a devDependency, no
 * application code imports it, so it cannot reach the client bundle. Vercel does
 * install devDependencies during a build, but browsers are downloaded only by an
 * explicit `playwright install`, which Vercel never runs — so deploys are
 * unaffected in size and time. `testDir` is scoped to the POS browser folder so
 * `next build` and the tsx suites never pick these up.
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.POS_HARNESS_PORT ?? 8097);

export default defineConfig({
  testDir: "lib/pos/__tests__/browser",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false, // these tests share one origin's IndexedDB / localStorage
  workers: 1,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${PORT}`,
  },
  // Serves the static harness pages. Playwright starts and stops it, so there is
  // no stray background server to clean up.
  webServer: {
    command: `npx --yes http-server lib/pos/__tests__/browser -p ${PORT} -c-1 --silent`,
    url: `http://127.0.0.1:${PORT}/multi-tab.html`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
