import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind CSS classes with clsx.
 *
 * (The mock-era helpers that formatted major-unit currency and invented
 * driver statuses are gone: money is shown only through `money.ts`, from the
 * server's integer minor units.)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
