import { clsx, ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind-aware class name concatenator. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
