import type { SortOrder } from 'mongoose';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export function buildPaginationMeta(page: number, limit: number, total: number): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 };
}

export const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Anchored prefix regex on a lower-cased field. Unlike `/term/i`, an anchored
 * case-sensitive regex can use a B-tree index as a bounded range scan.
 */
export const prefixRegex = (term: string) => new RegExp(`^${escapeRegex(term.trim().toLowerCase())}`);

export function dateRange(from?: Date, to?: Date) {
  if (!from && !to) return undefined;
  const range: { $gte?: Date; $lte?: Date } = {};
  if (from) range.$gte = from;
  if (to) {
    // Treat a bare date as inclusive of the whole day.
    const end = new Date(to);
    if (end.getUTCHours() === 0 && end.getUTCMinutes() === 0) end.setUTCHours(23, 59, 59, 999);
    range.$lte = end;
  }
  return range;
}

/** Converts "-createdAt" / "name" into a Mongo sort object with a stable _id tie-breaker. */
export function parseSort(sort: string): Record<string, SortOrder> {
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  return { [field]: desc ? -1 : 1, _id: desc ? -1 : 1 };
}
