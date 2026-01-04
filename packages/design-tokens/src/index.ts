/**
 * UBI Design System - Design Tokens
 * 
 * This module exports the design tokens for the UBI Design System.
 * Tokens are available in multiple formats:
 * - CSS Custom Properties (import '@ubi/design-tokens/css')
 * - TypeScript constants (import from '@ubi/design-tokens')
 * - Tailwind theme (import '@ubi/design-tokens/tailwind')
 * 
 * @packageDocumentation
 */

// Re-export tokens
export * from '../dist/ts/tokens';

// Token types
export interface ColorToken {
  $value: string;
  $type: 'color';
  $description?: string;
}

export interface DimensionToken {
  $value: string;
  $type: 'dimension';
  $description?: string;
}

export interface FontFamilyToken {
  $value: string;
  $type: 'fontFamily';
  $description?: string;
}

export interface FontWeightToken {
  $value: string | number;
  $type: 'fontWeight';
  $description?: string;
}

export interface DurationToken {
  $value: string;
  $type: 'duration';
  $description?: string;
}

export interface CubicBezierToken {
  $value: string;
  $type: 'cubicBezier';
  $description?: string;
}

export interface ShadowToken {
  $value: string;
  $type: 'shadow';
  $description?: string;
}

export type Token =
  | ColorToken
  | DimensionToken
  | FontFamilyToken
  | FontWeightToken
  | DurationToken
  | CubicBezierToken
  | ShadowToken;

// CSS variable helper
export function cssVar(tokenPath: string, fallback?: string): string {
  const varName = `--ubi-${tokenPath.replace(/\./g, '-')}`;
  return fallback ? `var(${varName}, ${fallback})` : `var(${varName})`;
}

// Token categories
export const tokenCategories = [
  'color',
  'spacing',
  'font',
  'radius',
  'shadow',
  'motion',
  'breakpoint',
  'zIndex',
  'opacity',
] as const;

export type TokenCategory = typeof tokenCategories[number];
