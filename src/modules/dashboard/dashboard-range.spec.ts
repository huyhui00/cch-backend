/// <reference types="jest" />
import { BadRequestException } from '@nestjs/common';

import {
  buildBuckets,
  DashboardGroupBy,
  DashboardPeriod,
  resolveDashboardRange,
} from './dashboard-range';

// 2026-09-29 เป็นวันอังคาร
const TODAY = '2026-09-29';

describe('resolveDashboardRange', () => {
  it('ไม่ส่งอะไร = เดือนนี้ถึงวันนี้ แบ่งรายวัน', () => {
    expect(resolveDashboardRange({}, TODAY)).toEqual({
      period: DashboardPeriod.MONTH,
      dateFrom: '2026-09-01',
      dateTo: TODAY,
      groupBy: DashboardGroupBy.DAY,
    });
  });

  it('WEEK เริ่มวันจันทร์', () => {
    const range = resolveDashboardRange({ period: DashboardPeriod.WEEK }, TODAY);
    expect(range.dateFrom).toBe('2026-09-28');
    expect(range.dateTo).toBe(TODAY);
  });

  it('QUARTER เริ่มต้นไตรมาส แบ่งรายสัปดาห์ · YEAR เริ่ม 1 ม.ค. แบ่งรายเดือน', () => {
    expect(resolveDashboardRange({ period: DashboardPeriod.QUARTER }, TODAY)).toMatchObject({
      dateFrom: '2026-07-01',
      groupBy: DashboardGroupBy.WEEK,
    });
    expect(resolveDashboardRange({ period: DashboardPeriod.YEAR }, TODAY)).toMatchObject({
      dateFrom: '2026-01-01',
      groupBy: DashboardGroupBy.MONTH,
    });
  });

  it('ส่ง dateFrom/dateTo โดยไม่ระบุ period = CUSTOM · groupBy ที่ส่งมาชนะ', () => {
    expect(
      resolveDashboardRange(
        { dateFrom: '2026-01-01', dateTo: '2026-03-31', groupBy: DashboardGroupBy.MONTH },
        TODAY,
      ),
    ).toEqual({
      period: DashboardPeriod.CUSTOM,
      dateFrom: '2026-01-01',
      dateTo: '2026-03-31',
      groupBy: DashboardGroupBy.MONTH,
    });
  });

  it.each([
    [{ period: DashboardPeriod.CUSTOM, dateFrom: '2026-01-01' }],
    [{ period: DashboardPeriod.MONTH, dateFrom: '2026-01-01', dateTo: '2026-01-31' }],
    [{ dateFrom: '2026-05-01', dateTo: '2026-04-01' }],
    [{ dateFrom: '2016-01-01', dateTo: '2026-01-01' }],
    [{ dateFrom: '2025-01-01', dateTo: '2026-06-30', groupBy: DashboardGroupBy.DAY }],
  ])('คำขอไม่ถูกต้อง → 400 (%j)', (query) => {
    expect(() => resolveDashboardRange(query, TODAY)).toThrow(BadRequestException);
  });
});

describe('buildBuckets', () => {
  it('รายสัปดาห์ ตัดช่วงแรก/สุดท้ายให้อยู่ในช่วงที่เลือก', () => {
    expect(
      buildBuckets({
        period: DashboardPeriod.CUSTOM,
        dateFrom: '2026-09-02',
        dateTo: '2026-09-16',
        groupBy: DashboardGroupBy.WEEK,
      }),
    ).toEqual([
      { periodStart: '2026-09-02', periodEnd: '2026-09-06' },
      { periodStart: '2026-09-07', periodEnd: '2026-09-13' },
      { periodStart: '2026-09-14', periodEnd: '2026-09-16' },
    ]);
  });

  it('รายเดือนข้ามปี ต่อเนื่องไม่ขาดเดือน', () => {
    const buckets = buildBuckets({
      period: DashboardPeriod.CUSTOM,
      dateFrom: '2025-11-15',
      dateTo: '2026-02-10',
      groupBy: DashboardGroupBy.MONTH,
    });
    expect(buckets.map((bucket) => bucket.periodStart)).toEqual([
      '2025-11-15',
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
    ]);
    expect(buckets[0].periodEnd).toBe('2025-11-30');
    expect(buckets[3].periodEnd).toBe('2026-02-10');
  });
});
