import { BadRequestException } from '@nestjs/common';
import { Op, type WhereOptions } from 'sequelize';

export interface CursorPosition {
  createdAt: Date;
  id: number;
}

export interface CursorRow {
  createdAt: Date;
  id: number;
}

export interface CursorPaginatedResult<T> {
  items: T[];
  total: null;
  page: null;
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}

const CURSOR_PATTERN = /^(\d{1,15})_(\d{1,12})$/;

export function encodeCursor(row: CursorRow): string {
  return `${row.createdAt.getTime()}_${row.id}`;
}

export function decodeCursor(raw: string): CursorPosition {
  const match = CURSOR_PATTERN.exec(raw);

  if (!match) {
    throw new BadRequestException('cursor ไม่ถูกต้อง ให้ใช้ค่า nextCursor จากผลลัพธ์ก่อนหน้า');
  }

  return { createdAt: new Date(Number(match[1])), id: Number(match[2]) };
}

export function olderThan(position: CursorPosition): WhereOptions {
  return {
    [Op.or]: [
      { createdAt: { [Op.lt]: position.createdAt } },
      { createdAt: position.createdAt, id: { [Op.lt]: position.id } },
    ],
  };
}

export function toCursorResult<TRow extends CursorRow, TItem>(
  rows: TRow[],
  limit: number,
  map: (row: TRow) => TItem,
): CursorPaginatedResult<TItem> {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];

  return {
    items: pageRows.map(map),
    total: null,
    page: null,
    limit,
    nextCursor: hasMore && last ? encodeCursor(last) : null,
    hasMore,
  };
}
