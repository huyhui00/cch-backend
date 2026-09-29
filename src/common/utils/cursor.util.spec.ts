/// <reference types="jest" />
import { BadRequestException } from '@nestjs/common';
import { Op } from 'sequelize';

import { decodeCursor, encodeCursor, olderThan, toCursorResult } from './cursor.util';

const at = new Date('2026-09-24T04:53:45.000Z');

describe('cursor.util', () => {
  it('encode แล้ว decode กลับได้ตำแหน่งเดิม', () => {
    const cursor = encodeCursor({ createdAt: at, id: 3041 });

    expect(decodeCursor(cursor)).toEqual({ createdAt: at, id: 3041 });
  });

  it.each(['', 'abc', '123', '123_', '_5', '1_2_3', '-1_5', "1_1' OR 1=1"])(
    'cursor "%s" ไม่ถูกต้อง → 400',
    (raw) => {
      expect(() => decodeCursor(raw)).toThrow(BadRequestException);
    },
  );

  it('เงื่อนไขเก่ากว่า ใช้ id ตัดสินเมื่อเวลาเท่ากัน (created_at ละเอียดแค่วินาที)', () => {
    const where = olderThan({ createdAt: at, id: 50 }) as Record<symbol, unknown>;

    expect(where[Op.or]).toEqual([
      { createdAt: { [Op.lt]: at } },
      { createdAt: at, id: { [Op.lt]: 50 } },
    ]);
  });

  it('ได้แถวเกิน limit = ยังมีต่อ และ nextCursor ชี้แถวสุดท้ายที่คืนจริง', () => {
    const rows = [3, 2, 1].map((id) => ({ id, createdAt: at }));

    const result = toCursorResult(rows, 2, (row) => row.id);

    expect(result).toEqual({
      items: [3, 2],
      total: null,
      page: null,
      limit: 2,
      nextCursor: encodeCursor({ createdAt: at, id: 2 }),
      hasMore: true,
    });
  });

  it('ได้แถวไม่เกิน limit = หมดแล้ว ไม่มี nextCursor', () => {
    const rows = [2, 1].map((id) => ({ id, createdAt: at }));

    const result = toCursorResult(rows, 2, (row) => row.id);

    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
    expect(result.items).toEqual([2, 1]);
  });
});
