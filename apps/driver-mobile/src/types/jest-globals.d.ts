// Ambient Jest globals for `tsc --noEmit`.
//
// Under pnpm's strict node_modules, @types/jest is present in the workspace
// store but is not linked into this app (it is not a declared dependency), so
// TypeScript cannot see the runner globals Jest injects at runtime. Rather than
// pull an un-installed package, we declare the small surface the driver tests
// use. The proper fix in RN-01 is to add `@types/jest` as a devDependency and
// delete this file (noted as a gap).

interface UbiJestMatchers {
  toBe(expected: unknown): void;
  toBeTruthy(): void;
  toBeNull(): void;
  toBeDefined(): void;
  toContain(expected: unknown): void;
  readonly not: UbiJestMatchers;
}

declare function expect(actual: unknown): UbiJestMatchers;
declare function describe(name: string, fn: () => void): void;
declare function it(name: string, fn?: () => void | Promise<void>, timeout?: number): void;
declare function beforeEach(fn: () => void | Promise<void>): void;
declare function afterEach(fn: () => void | Promise<void>): void;
