/**
 * Entry point for the live model evaluation (tests/eval/model-eval.ts).
 *
 *   pnpm --filter @ubi/ask-service exec tsx tests/eval/run-model-eval.ts
 *
 * Exits 2 with the reason when no deployed, attested endpoint (or no scratch
 * database) is configured — see docs/MODEL-SERVING.md.
 */
import { main } from "./model-eval";

void main().then(
  (code) => {
    process.exit(code);
  },
  (error: unknown) => {
    process.stderr.write(
      `EVAL FAILED: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(2);
  },
);
