import { ApiProperty } from '@nestjs/swagger';

import { DashboardGroupBy, DashboardPeriod } from '../dashboard-range';

/**
 * จำนวนสิ่งที่ผู้ใช้ทำในช่วงเวลา — null = ไม่มีสิทธิ์ดูหน้าของเรื่องนั้น (ไม่ใช่ 0)
 *
 * ตัวเลขดิบล้วน ห้ามเติมอันดับ ค่าเฉลี่ยทีม เป้าหมาย หรือคะแนน (Q21 — ระบบนี้ไม่ใช่ระบบ HR)
 */
export class DashboardMetricsDto {
  @ApiProperty({
    nullable: true,
    example: 1,
    description: 'โปรเจคที่ฉันเป็นผู้จัดการและส่งมอบเสร็จ (actual_end_date) ไม่นับที่ยกเลิก',
  })
  projectsDelivered: number | null;

  @ApiProperty({
    nullable: true,
    example: 12,
    description: 'งานย่อยที่มอบให้ฉันและเสร็จ (completed_at)',
  })
  tasksCompleted: number | null;

  @ApiProperty({
    nullable: true,
    example: 4,
    description: 'รอบการแก้ใบปัญหาที่ฉันเป็นผู้แก้ (resolved_at) — ใบเดียวแก้หลายรอบนับทุกรอบ',
  })
  ticketRoundsResolved: number | null;

  @ApiProperty({
    nullable: true,
    example: 6,
    description: 'งานติดตามของฉันที่ปิดเป็น DONE (completed_at)',
  })
  followUpsCompleted: number | null;

  @ApiProperty({
    nullable: true,
    example: 9,
    description: 'การติดต่อลูกค้าที่ฉันเป็นคนคุย (handled_by · occurred_at วันที่คุยจริง)',
  })
  communicationsLogged: number | null;
}

export class DashboardSeriesPointDto extends DashboardMetricsDto {
  @ApiProperty({ example: '2026-09-01' })
  periodStart: string;

  @ApiProperty({ example: '2026-09-07', description: 'รวมวันนั้นด้วย' })
  periodEnd: string;
}

export class MyDashboardDto {
  @ApiProperty({ enum: DashboardPeriod })
  period: DashboardPeriod;

  @ApiProperty({ example: '2026-09-01' })
  dateFrom: string;

  @ApiProperty({ example: '2026-09-29' })
  dateTo: string;

  @ApiProperty({ enum: DashboardGroupBy })
  groupBy: DashboardGroupBy;

  @ApiProperty({ type: DashboardMetricsDto, description: 'ยอดรวมทั้งช่วง' })
  totals: DashboardMetricsDto;

  @ApiProperty({
    nullable: true,
    example: 2,
    description:
      'ณ ตอนนี้ — โปรเจคที่ฉันเป็นผู้จัดการและยังเป็น DRAFT/IN_PROGRESS (ไม่ขึ้นกับช่วงเวลา)',
  })
  projectsInProgress: number | null;

  @ApiProperty({
    type: [DashboardSeriesPointDto],
    description:
      'ทุกช่วงย่อยต่อเนื่อง ช่วงที่ไม่มีข้อมูล = 0 · ช่วงแรก/สุดท้ายถูกตัดให้อยู่ในช่วงที่เลือก',
  })
  series: DashboardSeriesPointDto[];
}
