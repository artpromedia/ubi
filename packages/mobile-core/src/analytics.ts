// Client analytics — never PII, never money truth (server events carry money). Wire to @ubi/analytics transport in RN-01.
type Props = Record<string, string | number | boolean | undefined>;
let sink: (name: string, props: Props) => void = (name, props) => { if (__DEV__) console.log('[analytics]', name, props); };
export function setAnalyticsSink(s: typeof sink) { sink = s; }
export function track(name: string, props: Props = {}) {
  for (const k of Object.keys(props)) { if (/phone|email|name|pin|card|address/i.test(k)) delete props[k]; }
  sink(name, props);
}
