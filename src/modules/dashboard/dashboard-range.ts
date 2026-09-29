import { BadRequestException } from '@nestjs/common';

import { addDays, addMonths, todayAsDateOnly } from '../../common/utils/date.util';

export enum DashboardPeriod {
  WEEK = 'WEEK',
  MONTH = 'MONTH',
  QUARTER = 'QUARTER',
  YEAR = 'YEAR',
  CUSTOM = 'CUSTOM',
}

export enum DashboardGroupBy {
  DAY = 'DAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH',
}

/** ช่วงยาวสุด 120 เดือน — หลักเดียวกับสรุปคะแนนแบบประเมิน กันคำขอที่พิมพ์ปีผิด */
export const MAX_RANGE_MONTHS = 120;
/** แบ่งรายวันได้ไม่เกินหนึ่งปี ไม่งั้นกราฟมีหลายพันแท่ง */
export const MAX_DAY_BUCKETS = 366;

export interface DashboardRange {
  period: DashboardPeriod;
  dateFrom: string;
  dateTo: string;
  groupBy: DashboardGroupBy;
}

export interface DashboardBucket {
  periodStart: string;
  periodEnd: string;
}

function dayOfWeekMondayFirst(dateOnly: string): number {
  const [year, month, day] = dateOnly.split('-').map(Number);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** วันแรกของช่วงที่ครอบวันที่นี้ (สัปดาห์เริ่มวันจันทร์) */
export function bucketStartOf(dateOnly: string, groupBy: DashboardGroupBy): string {
  if (groupBy === DashboardGroupBy.DAY) {
    return dateOnly;
  }
  if (groupBy === DashboardGroupBy.WEEK) {
    return addDays(dateOnly, -dayOfWeekMondayFirst(dateOnly));
  }
  return `${dateOnly.slice(0, 7)}-01`;
}

function nextBucketStart(start: string, groupBy: DashboardGroupBy): string {
  if (groupBy === DashboardGroupBy.DAY) {
    return addDays(start, 1);
  }
  if (groupBy === DashboardGroupBy.WEEK) {
    return addDays(start, 7);
  }
  return addMonths(start, 1);
}

function defaultGroupBy(dateFrom: string, dateTo: string): DashboardGroupBy {
  const days = daysBetween(dateFrom, dateTo) + 1;
  if (days <= 31) {
    return DashboardGroupBy.DAY;
  }
  if (days <= 184) {
    return DashboardGroupBy.WEEK;
  }
  return DashboardGroupBy.MONTH;
}

/**
 * ช่วงสำเร็จรูปนับจากต้นช่วงถึง "วันนี้" ไม่ใช่ถึงปลายเดือน/ปลายปี
 * ไม่งั้นกราฟมีแท่งศูนย์ของวันที่ยังมาไม่ถึง ซึ่งอ่านแล้วเหมือนไม่ได้ทำงาน
 */
function presetRange(period: DashboardPeriod, today: string): { dateFrom: string; dateTo: string } {
  const [year, month] = today.split('-').map(Number);

  switch (period) {
    case DashboardPeriod.WEEK:
      return { dateFrom: bucketStartOf(today, DashboardGroupBy.WEEK), dateTo: today };
    case DashboardPeriod.QUARTER: {
      const quarterMonth = Math.floor((month - 1) / 3) * 3 + 1;
      return { dateFrom: `${year}-${String(quarterMonth).padStart(2, '0')}-01`, dateTo: today };
    }
    case DashboardPeriod.YEAR:
      return { dateFrom: `${year}-01-01`, dateTo: today };
    default:
      return { dateFrom: `${today.slice(0, 7)}-01`, dateTo: today };
  }
}

export function resolveDashboardRange(
  query: {
    period?: DashboardPeriod;
    dateFrom?: string;
    dateTo?: string;
    groupBy?: DashboardGroupBy;
  },
  today: string = todayAsDateOnly(),
): DashboardRange {
  const hasCustomDates = query.dateFrom !== undefined || query.dateTo !== undefined;
  const period = query.period ?? (hasCustomDates ? DashboardPeriod.CUSTOM : DashboardPeriod.MONTH);

  let dateFrom: string;
  let dateTo: string;

  if (period === DashboardPeriod.CUSTOM) {
    if (!query.dateFrom || !query.dateTo) {
      throw new BadRequestException('ช่วงเวลากำหนดเองต้องส่งทั้ง dateFrom และ dateTo');
    }
    dateFrom = query.dateFrom;
    dateTo = query.dateTo;
  } else {
    if (hasCustomDates) {
      throw new BadRequestException('dateFrom / dateTo ใช้ได้กับ period=CUSTOM เท่านั้น');
    }
    ({ dateFrom, dateTo } = presetRange(period, today));
  }

  if (dateTo < dateFrom) {
    throw new BadRequestException('dateTo ต้องไม่อยู่ก่อน dateFrom');
  }
  if (dateTo >= addMonths(dateFrom, MAX_RANGE_MONTHS)) {
    throw new BadRequestException(
      `ช่วงเวลากว้างเกินไป — เลือกได้ไม่เกิน ${MAX_RANGE_MONTHS} เดือนต่อครั้ง`,
    );
  }

  const groupBy = query.groupBy ?? defaultGroupBy(dateFrom, dateTo);

  if (groupBy === DashboardGroupBy.DAY && daysBetween(dateFrom, dateTo) + 1 > MAX_DAY_BUCKETS) {
    throw new BadRequestException(
      `แบ่งรายวันได้ไม่เกิน ${MAX_DAY_BUCKETS} วัน — เลือกแบ่งรายสัปดาห์หรือรายเดือนแทน`,
    );
  }

  return { period, dateFrom, dateTo, groupBy };
}

/**
 * ช่วงย่อยต่อเนื่องครอบทั้งช่วง ช่วงแรก/สุดท้ายถูกตัดให้อยู่ใน dateFrom..dateTo
 * (เลือก 10–20 ก.ย. แบ่งรายเดือน ได้ช่วงเดียวคือ 10–20 ก.ย. ไม่ใช่ทั้งเดือน)
 */
export function buildBuckets(range: DashboardRange): DashboardBucket[] {
  const buckets: DashboardBucket[] = [];
  let start = bucketStartOf(range.dateFrom, range.groupBy);

  while (start <= range.dateTo) {
    const next = nextBucketStart(start, range.groupBy);
    const end = addDays(next, -1);
    buckets.push({
      periodStart: start < range.dateFrom ? range.dateFrom : start,
      periodEnd: end > range.dateTo ? range.dateTo : end,
    });
    start = next;
  }

  return buckets;
}
