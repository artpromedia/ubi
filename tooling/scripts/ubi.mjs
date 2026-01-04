#!/usr/bin/env node

/**
 * UBI Development Scripts
 * 
 * Common development utilities
 */

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const commands = {
  // =============================================================================
  // Docker Commands
  // =============================================================================
  
  'docker:up': {
    description: 'Start development infrastructure',
    run: () => {
      console.log('🐳 Starting Docker containers...\n');
      execSync('docker compose -f docker/docker-compose.dev.yml up -d', {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
      console.log('\n✅ Docker containers started!');
      console.log('\nServices:');
      console.log('  PostgreSQL: localhost:5432');
      console.log('  Redis:      localhost:6379');
      console.log('  MinIO:      localhost:9000 (Console: localhost:9001)');
      console.log('  MailHog:    localhost:8025');
      console.log('  Redis Commander: localhost:8081');
    },
  },
  
  'docker:down': {
    description: 'Stop development infrastructure',
    run: () => {
      console.log('🐳 Stopping Docker containers...\n');
      execSync('docker compose -f docker/docker-compose.dev.yml down', {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
      console.log('\n✅ Docker containers stopped!');
    },
  },
  
  'docker:logs': {
    description: 'View Docker container logs',
    run: () => {
      execSync('docker compose -f docker/docker-compose.dev.yml logs -f', {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
    },
  },
  
  'docker:clean': {
    description: 'Remove all Docker volumes',
    run: () => {
      console.log('🧹 Cleaning Docker volumes...\n');
      execSync('docker compose -f docker/docker-compose.dev.yml down -v', {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
      console.log('\n✅ Docker volumes removed!');
    },
  },
  
  // =============================================================================
  // Database Commands
  // =============================================================================
  
  'db:migrate:dev': {
    description: 'Create and apply database migrations',
    run: () => {
      console.log('🗄️  Running database migrations...\n');
      execSync('pnpm --filter @ubi/database prisma migrate dev', {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
    },
  },
  
  'db:migrate': {
    description: 'Apply pending migrations',
    run: () => {
      console.log('🗄️  Applying database migrations...\n');
      execSync('pnpm --filter @ubi/database prisma migrate deploy', {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
    },
  },
  
  'db:seed': {
    description: 'Seed the database',
    run: () => {
      console.log('🌱 Seeding database...\n');
      execSync('pnpm --filter @ubi/database prisma db seed', {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
    },
  },
  
  'db:studio': {
    description: 'Open Prisma Studio',
    run: () => {
      console.log('🎨 Opening Prisma Studio...\n');
      execSync('pnpm --filter @ubi/database prisma studio', {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
    },
  },
  
  'db:reset': {
    description: 'Reset database (WARNING: destroys all data)',
    run: () => {
      console.log('⚠️  Resetting database...\n');
      execSync('pnpm --filter @ubi/database prisma migrate reset --force', {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
    },
  },
  
  // =============================================================================
  // Code Quality Commands
  // =============================================================================
  
  'lint:fix': {
    description: 'Fix linting issues',
    run: () => {
      console.log('🔧 Fixing linting issues...\n');
      execSync('pnpm turbo lint -- --fix', {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
    },
  },
  
  'format': {
    description: 'Format code with Prettier',
    run: () => {
      console.log('✨ Formatting code...\n');
      execSync('pnpm prettier --write "**/*.{ts,tsx,js,jsx,json,md}"', {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
    },
  },
  
  'check': {
    description: 'Run all checks (lint, typecheck, test)',
    run: () => {
      console.log('🔍 Running all checks...\n');
      execSync('pnpm turbo lint typecheck test', {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
    },
  },
  
  // =============================================================================
  // Build Commands
  // =============================================================================
  
  'build:affected': {
    description: 'Build only affected packages',
    run: () => {
      console.log('🏗️  Building affected packages...\n');
      execSync('pnpm turbo build --filter=...[origin/main]', {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
    },
  },
  
  'clean': {
    description: 'Clean all build artifacts',
    run: () => {
      console.log('🧹 Cleaning build artifacts...\n');
      execSync('pnpm turbo clean', {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
      // Also clean node_modules
      console.log('Removing node_modules...');
      execSync('find . -name "node_modules" -type d -prune -exec rm -rf {} +', {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
      console.log('\n✅ Clean complete!');
    },
  },
  
  // =============================================================================
  // Development Commands
  // =============================================================================
  
  'dev:web': {
    description: 'Start web app in development mode',
    run: () => {
      console.log('🚀 Starting web app...\n');
      execSync('pnpm --filter @ubi/web-app dev', {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
    },
  },
  
  'dev:admin': {
    description: 'Start admin dashboard in development mode',
    run: () => {
      console.log('🚀 Starting admin dashboard...\n');
      execSync('pnpm --filter @ubi/admin-dashboard dev', {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
    },
  },
  
  'dev:services': {
    description: 'Start all backend services',
    run: () => {
      console.log('🚀 Starting backend services...\n');
      execSync('pnpm turbo dev --filter="./services/*"', {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
    },
  },
  
  // =============================================================================
  // Utility Commands
  // =============================================================================
  
  'deps:check': {
    description: 'Check for outdated dependencies',
    run: () => {
      console.log('📦 Checking for outdated dependencies...\n');
      execSync('pnpm outdated -r', {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
    },
  },
  
  'deps:update': {
    description: 'Update dependencies interactively',
    run: () => {
      console.log('📦 Updating dependencies...\n');
      execSync('pnpm update -i -r', {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
    },
  },
  
  'info': {
    description: 'Show project information',
    run: () => {
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8')
      );
      
      console.log('\n📦 UBI Monorepo\n');
      console.log(`Version: ${packageJson.version || '0.0.0'}`);
      console.log(`Node.js: ${process.version}`);
      console.log(`pnpm: ${execSync('pnpm --version').toString().trim()}`);
      
      // Count packages
      const apps = fs.readdirSync(path.join(ROOT_DIR, 'apps')).filter(
        f => fs.statSync(path.join(ROOT_DIR, 'apps', f)).isDirectory()
      );
      const services = fs.readdirSync(path.join(ROOT_DIR, 'services')).filter(
        f => fs.statSync(path.join(ROOT_DIR, 'services', f)).isDirectory()
      );
      const packages = fs.readdirSync(path.join(ROOT_DIR, 'packages')).filter(
        f => fs.statSync(path.join(ROOT_DIR, 'packages', f)).isDirectory()
      );
      
      console.log(`\nPackages:`);
      console.log(`  Apps:     ${apps.length}`);
      console.log(`  Services: ${services.length}`);
      console.log(`  Packages: ${packages.length}`);
      console.log(`  Total:    ${apps.length + services.length + packages.length}`);
      console.log('');
    },
  },
};

// Main
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === 'help') {
  console.log(`
UBI Development Scripts

Usage:
  pnpm ubi <command>

Commands:`);
  
  for (const [name, cmd] of Object.entries(commands)) {
    console.log(`  ${name.padEnd(20)} ${cmd.description}`);
  }
  
  console.log('');
  process.exit(0);
}

const command = commands[args[0]];

if (!command) {
  console.error(`❌ Unknown command: ${args[0]}`);
  console.log('Run "pnpm ubi help" to see available commands.');
  process.exit(1);
}

try {
  command.run();
} catch (error) {
  console.error(`\n❌ Command failed: ${error.message}`);
  process.exit(1);
}
