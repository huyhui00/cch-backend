/// <reference types="jest" />

import { NotificationEventType } from '../../models';
import {
  DIGEST_MESSAGE_LIMIT,
  buildDigest,
  dateLine,
  daysBetween,
  digestItem,
  isWithinNotifyHours,
  itemTitle,
  parseClockTime,
  relativeDays,
  thaiDigestDate,
} from './notification-digest';

const TODAY = '2026-10-08'; // วันพฤหัสบดี

describe('notification digest', () => {
  describe('ป้ายวันที่', () => {
    it('นับวันข้ามเดือนได้', () => {
      expect(daysBetween('2026-10-30', '2026-11-02')).toBe(3);
      expect(daysBetween('2026-11-02', '2026-10-30')).toBe(-3);
    });

    it('ระยะจากวันนี้: เลยมา / วันนี้ / พรุ่งนี้ / อีก N วัน', () => {
      expect(relativeDays('2026-10-06', TODAY)).toBe('เลยมา 2 วัน');
      expect(relativeDays(TODAY, TODAY)).toBe('วันนี้');
      expect(relativeDays('2026-10-09', TODAY)).toBe('พรุ่งนี้');
      expect(relativeDays('2026-11-07', TODAY)).toBe('อีก 30 วัน');
    });

    it('บรรทัดวันที่: ยังไม่เลยแสดงแค่วัน · เลยแล้วบอกว่าเลยมากี่วัน', () => {
      expect(dateLine('วันจบตามแผน', '2026-10-10', TODAY)).toBe('วันจบตามแผน 10 ต.ค.');
      expect(dateLine('วันจบตามแผน', '2026-10-01', TODAY)).toBe('วันจบตามแผน 1 ต.ค. (เลยมา 7 วัน)');
      expect(dateLine('กำหนดส่ง', TODAY, TODAY, true)).toBe('กำหนดส่ง 8 ต.ค. (เลยกำหนดวันนี้)');
    });

    it('หัวเรื่องใช้วันย่อภาษาไทยและปี พ.ศ. สองหลัก', () => {
      expect(thaiDigestDate(TODAY)).toBe('พฤ. 8 ต.ค. 69');
    });
  });

  describe('รายการ', () => {
    it('ชื่อเรื่องบรรทัดแรก รายละเอียดย่อหน้า และข้ามค่าว่าง', () => {
      expect(digestItem('โปรเจกต์: A', ['ลูกค้า: B', null, 'ครบ'])).toBe(
        'โปรเจกต์: A\n   ลูกค้า: B\n   ครบ',
      );
    });

    it('หัวเรื่องแถวกระดิ่ง: ใกล้ครบใช้หัวข้อ · เลยกำหนดบอกชนิด', () => {
      expect(itemTitle(NotificationEventType.DELIVERY_DUE, 'UPCOMING', 'หัวข้อ')).toBe('หัวข้อ');
      expect(itemTitle(NotificationEventType.DELIVERY_DUE, 'OVERDUE', 'หัวข้อ')).toBe(
        'เลยกำหนดแล้ว · โปรเจกต์',
      );
    });
  });

  describe('buildDigest', () => {
    it('ไม่มีรายการใหม่ = ไม่ส่ง', () => {
      expect(buildDigest(TODAY, [])).toBeNull();
    });

    it('ใกล้ครบอยู่ใต้หัวข้อของตัวเอง เรียงตามลำดับหัวข้อ ไม่ใช่ลำดับกฎ', () => {
      const digest = buildDigest(TODAY, [
        {
          eventType: NotificationEventType.MA_EXPIRING,
          heading: 'MA',
          total: 1,
          groups: [{ kind: 'UPCOMING', total: 1, items: ['m'] }],
          footer: 'โทรยืนยัน',
        },
        {
          eventType: NotificationEventType.DELIVERY_DUE,
          heading: 'โปรเจกต์',
          total: 1,
          groups: [{ kind: 'UPCOMING', total: 1, items: ['p'] }],
        },
      ]);

      expect(digest?.title).toBe('แจ้งเตือนกำหนดส่ง พฤ. 8 ต.ค. 69');
      expect(digest?.message).toBe('■ โปรเจกต์\n• p\n\n■ MA\n• m\n→ โทรยืนยัน');
    });

    it('รายการเลยกำหนดของทุกหัวข้อรวมเป็นก้อนเดียวท้ายข้อความ ไม่มีหัวข้อ ■', () => {
      const digest = buildDigest(TODAY, [
        {
          eventType: NotificationEventType.TASK_OVERDUE,
          heading: 'งาน',
          total: 9,
          groups: [
            { kind: 'UPCOMING', total: 1, items: ['u'] },
            { kind: 'OVERDUE', total: 8, items: ['o1', 'o2'] },
          ],
        },
        {
          eventType: NotificationEventType.DELIVERY_DUE,
          heading: 'โปรเจกต์',
          total: 1,
          groups: [{ kind: 'OVERDUE', total: 1, items: ['p'] }],
        },
      ]);

      expect(digest?.message).toBe(
        [
          '■ งาน',
          '• u',
          '',
          'เลยกำหนดแล้ว 9 รายการ',
          '• o1',
          '• o2',
          '   …งานที่เลยกำหนดอีก 6 รายการ ดูในระบบ',
          '• p',
        ].join('\n'),
      );
    });

    it('ข้อความยาวเกินเพดานถูกตัดที่ขึ้นบรรทัดใหม่', () => {
      const items = Array.from({ length: 200 }, (_, i) => `รายการยาว ๆ ลำดับที่ ${i} `.repeat(3));
      const digest = buildDigest(TODAY, [
        {
          eventType: NotificationEventType.TICKET_SLA,
          heading: 'ปัญหา',
          total: items.length,
          groups: [{ kind: 'OVERDUE', total: items.length, items }],
        },
      ]);

      expect(digest!.message.length).toBeLessThanOrEqual(DIGEST_MESSAGE_LIMIT);
      expect(digest!.message.endsWith('ดูรายการทั้งหมดในระบบ')).toBe(true);
    });
  });

  describe('ช่วงเวลาส่ง', () => {
    const start = { hour: 8, minute: 30 };
    const end = { hour: 18, minute: 0 };

    it('อ่านรูปแบบ HH:MM และปฏิเสธค่าที่ผิด', () => {
      expect(parseClockTime('08:30')).toEqual({ hour: 8, minute: 30 });
      expect(parseClockTime('7:05')).toEqual({ hour: 7, minute: 5 });
      expect(parseClockTime('25:00')).toBeNull();
      expect(parseClockTime('8.30')).toBeNull();
      expect(parseClockTime(undefined)).toBeNull();
    });

    it('ส่งเฉพาะในช่วงเวลา — 18:00 ตรงไม่ส่งแล้ว', () => {
      expect(isWithinNotifyHours(new Date(2026, 9, 8, 8, 29), start, end, false)).toBe(false);
      expect(isWithinNotifyHours(new Date(2026, 9, 8, 8, 30), start, end, false)).toBe(true);
      expect(isWithinNotifyHours(new Date(2026, 9, 8, 17, 59), start, end, false)).toBe(true);
      expect(isWithinNotifyHours(new Date(2026, 9, 8, 18, 0), start, end, false)).toBe(false);
    });

    it('เสาร์–อาทิตย์ไม่ส่ง เว้นแต่เปิดไว้', () => {
      const saturday = new Date(2026, 9, 10, 9, 0);
      expect(isWithinNotifyHours(saturday, start, end, false)).toBe(false);
      expect(isWithinNotifyHours(saturday, start, end, true)).toBe(true);
    });
  });
});
