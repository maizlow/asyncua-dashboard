import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Checks if a value is a valid finite number.
 * Accepts both `number` and `string` types.
 */
export function isValidNumber(value: number | string | null | undefined): value is number {
  if (value === null || value === undefined) return false

  if (typeof value === "number") {
    return Number.isFinite(value)
  }

  if (typeof value === "string") {
    const trimmed = value.trim()
    if (trimmed === "") return false

    const num = Number(trimmed)
    return Number.isFinite(num)
  }

  return false
}

/**
 * Safely converts a value to a number.
 * Returns the fallback value if conversion fails.
 */
export function toNumber(
  value: number | string | null | undefined, 
  fallback: number = 0
): number {
  if (isValidNumber(value)) return value

  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}