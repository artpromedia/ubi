/**
 * Runs once when the server starts (Next.js instrumentation hook). Lists the
 * destinations that will render as launch-status copy, so an environment with
 * a missing store or legal URL is visible in the log rather than only on the
 * page. Build-time reporting lives in next.config.mjs.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportUnsetDestinations } = await import("./lib/destination-env.mjs");
  reportUnsetDestinations();
}
