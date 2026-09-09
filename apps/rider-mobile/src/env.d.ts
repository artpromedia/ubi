// Metro/React Native injects process.env at build time (UBI_API_BASE, UBI_FIXTURES,
// NODE_ENV). tsc needs the ambient shape without pulling all of @types/node.
declare const process: { env: { [key: string]: string | undefined } };
