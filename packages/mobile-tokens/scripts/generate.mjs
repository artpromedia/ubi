// Reads packages/design-tokens/tokens/{base,semantic,dark}.json and writes src/index.ts. Implement in RN-01; keep key names above.
import { readFileSync, writeFileSync } from 'node:fs';
const read = (p) => JSON.parse(readFileSync(new URL('../../design-tokens/tokens/' + p, import.meta.url), 'utf8'));
const [base, semantic, dark] = [read('base.json'), read('semantic.json'), read('dark.json')];
// TODO(RN-01): map semantic roles → the exported key set in src/index.ts; fail the build if a key is missing in either theme.
writeFileSync(new URL('../src/index.generated.json', import.meta.url), JSON.stringify({ base, semantic, dark }, null, 2));
