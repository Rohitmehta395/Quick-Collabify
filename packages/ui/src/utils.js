import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Utility function to merge Tailwind CSS classes and resolve conflicts.
 * Essential for shadcn/ui components.
 *
 * @param  {...import("clsx").ClassValue} inputs - Classes to merge
 * @returns {string} - Merged class string
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
