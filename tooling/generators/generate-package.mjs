#!/usr/bin/env node

/**
 * UBI Package Generator
 * 
 * Usage:
 *   pnpm generate:package <type> <name>
 * 
 * Types:
 *   - service   : Node.js backend service
 *   - app       : Next.js web application
 *   - package   : Shared library package
 *   - go-service: Go backend service
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const TEMPLATES = {
  service: {
    dir: 'services',
    files: {
      'package.json': (name, displayName) => JSON.stringify({
        name: `@ubi/${name}`,
        version: '0.0.0',
        private: true,
        type: 'module',
        scripts: {
          dev: 'tsx watch src/index.ts',
          build: 'tsup',
          start: 'node dist/index.js',
          lint: 'eslint src/',
          typecheck: 'tsc --noEmit',
          test: 'vitest run',
          'test:watch': 'vitest',
        },
        dependencies: {
          '@hono/node-server': '^1.13.7',
          hono: '^4.6.14',
          zod: '^3.24.1',
        },
        devDependencies: {
          '@ubi/eslint-config': 'workspace:*',
          '@ubi/typescript-config': 'workspace:*',
          '@types/node': '^20.17.10',
          eslint: '^9.17.0',
          tsup: '^8.3.5',
          tsx: '^4.19.2',
          typescript: '^5.7.2',
          vitest: '^2.1.8',
        },
      }, null, 2),
      
      'tsconfig.json': () => JSON.stringify({
        extends: '@ubi/typescript-config/node-service.json',
        compilerOptions: {
          outDir: './dist',
          rootDir: './src',
        },
        include: ['src/**/*'],
        exclude: ['node_modules', 'dist'],
      }, null, 2),
      
      'tsup.config.ts': () => `import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
});
`,
      
      'src/index.ts': (name, displayName) => `import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors());

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'healthy', service: '${name}' });
});

// Routes
app.get('/', (c) => {
  return c.json({ message: 'Welcome to ${displayName}' });
});

// Start server
const port = parseInt(process.env.PORT || '3000', 10);

console.log(\`🚀 ${displayName} starting on port \${port}\`);

serve({
  fetch: app.fetch,
  port,
});
`,
      
      'README.md': (name, displayName) => `# ${displayName}

## Overview

Description of ${displayName}.

## Development

\`\`\`bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build

# Run tests
pnpm test
\`\`\`

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check |
| GET | / | Service info |
`,
    },
  },
  
  app: {
    dir: 'apps',
    files: {
      'package.json': (name, displayName) => JSON.stringify({
        name: `@ubi/${name}`,
        version: '0.0.0',
        private: true,
        type: 'module',
        scripts: {
          dev: 'next dev',
          build: 'next build',
          start: 'next start',
          lint: 'next lint',
          typecheck: 'tsc --noEmit',
        },
        dependencies: {
          '@ubi/ui': 'workspace:*',
          '@ubi/utils': 'workspace:*',
          next: '^15.1.0',
          react: '^19.0.0',
          'react-dom': '^19.0.0',
        },
        devDependencies: {
          '@ubi/eslint-config': 'workspace:*',
          '@ubi/typescript-config': 'workspace:*',
          '@types/node': '^20.17.10',
          '@types/react': '^19.0.1',
          '@types/react-dom': '^19.0.2',
          autoprefixer: '^10.4.20',
          eslint: '^9.17.0',
          postcss: '^8.4.49',
          tailwindcss: '^3.4.17',
          typescript: '^5.7.2',
        },
      }, null, 2),
      
      'tsconfig.json': () => JSON.stringify({
        extends: '@ubi/typescript-config/nextjs.json',
        compilerOptions: {
          plugins: [{ name: 'next' }],
        },
        include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
        exclude: ['node_modules'],
      }, null, 2),
      
      'next.config.mjs': () => `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@ubi/ui', '@ubi/utils'],
};

export default nextConfig;
`,
      
      'tailwind.config.ts': () => `import type { Config } from 'tailwindcss';
import sharedConfig from '@ubi/ui/tailwind.config';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  presets: [sharedConfig],
};

export default config;
`,
      
      'postcss.config.mjs': () => `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`,
      
      'src/app/layout.tsx': (name, displayName) => `import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '${displayName} | UBI',
  description: '${displayName} - UBI Africa',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
      
      'src/app/page.tsx': (name, displayName) => `export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold">
        Welcome to ${displayName}
      </h1>
      <p className="mt-4 text-gray-600">
        Part of the UBI platform
      </p>
    </main>
  );
}
`,
      
      'src/app/globals.css': () => `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
    },
  },
  
  package: {
    dir: 'packages',
    files: {
      'package.json': (name, displayName) => JSON.stringify({
        name: `@ubi/${name}`,
        version: '0.0.0',
        private: true,
        type: 'module',
        main: './dist/index.js',
        module: './dist/index.js',
        types: './dist/index.d.ts',
        exports: {
          '.': {
            types: './dist/index.d.ts',
            import: './dist/index.js',
          },
        },
        scripts: {
          build: 'tsup',
          dev: 'tsup --watch',
          lint: 'eslint src/',
          typecheck: 'tsc --noEmit',
          test: 'vitest run',
          'test:watch': 'vitest',
        },
        devDependencies: {
          '@ubi/eslint-config': 'workspace:*',
          '@ubi/typescript-config': 'workspace:*',
          '@types/node': '^20.17.10',
          eslint: '^9.17.0',
          tsup: '^8.3.5',
          typescript: '^5.7.2',
          vitest: '^2.1.8',
        },
      }, null, 2),
      
      'tsconfig.json': () => JSON.stringify({
        extends: '@ubi/typescript-config/node-library.json',
        compilerOptions: {
          outDir: './dist',
          rootDir: './src',
        },
        include: ['src/**/*'],
        exclude: ['node_modules', 'dist'],
      }, null, 2),
      
      'tsup.config.ts': () => `import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
});
`,
      
      'src/index.ts': (name, displayName) => `/**
 * ${displayName}
 * 
 * Shared package for UBI
 */

export function hello(): string {
  return 'Hello from ${name}!';
}
`,
      
      'README.md': (name, displayName) => `# ${displayName}

Shared package for UBI.

## Installation

\`\`\`bash
pnpm add @ubi/${name}
\`\`\`

## Usage

\`\`\`typescript
import { hello } from '@ubi/${name}';

console.log(hello());
\`\`\`
`,
    },
  },
};

function toDisplayName(name) {
  return name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function generatePackage(type, name) {
  const template = TEMPLATES[type];
  
  if (!template) {
    console.error(`❌ Unknown type: ${type}`);
    console.log('Available types: service, app, package');
    process.exit(1);
  }
  
  const displayName = toDisplayName(name);
  const packageDir = path.join(ROOT_DIR, template.dir, name);
  
  if (fs.existsSync(packageDir)) {
    console.error(`❌ Directory already exists: ${packageDir}`);
    process.exit(1);
  }
  
  console.log(`\n🚀 Generating ${type}: @ubi/${name}\n`);
  
  // Create directory structure
  fs.mkdirSync(packageDir, { recursive: true });
  
  // Create files
  for (const [filePath, contentFn] of Object.entries(template.files)) {
    const fullPath = path.join(packageDir, filePath);
    const dir = path.dirname(fullPath);
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const content = contentFn(name, displayName);
    fs.writeFileSync(fullPath, content);
    console.log(`  ✅ Created ${filePath}`);
  }
  
  console.log(`\n✨ Successfully generated @ubi/${name}!`);
  console.log(`\nNext steps:`);
  console.log(`  1. cd ${template.dir}/${name}`);
  console.log(`  2. pnpm install`);
  console.log(`  3. pnpm dev`);
  console.log('');
}

// Main
const args = process.argv.slice(2);

if (args.length < 2) {
  console.log(`
UBI Package Generator

Usage:
  pnpm generate:package <type> <name>

Types:
  service    - Node.js backend service
  app        - Next.js web application
  package    - Shared library package

Examples:
  pnpm generate:package service pricing-service
  pnpm generate:package app driver-portal
  pnpm generate:package package analytics
`);
  process.exit(0);
}

const [type, name] = args;
generatePackage(type, name);
