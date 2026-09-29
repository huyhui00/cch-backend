import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, Matches } from 'class-validator';

import { DashboardGroupBy, DashboardPeriod } from '../dashboard-range';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** ไม่มี userId โดยเจตนา — แดชบอร์ดเป็นของผู้เรียกเท่านั้น (Q21) */
export class QueryMyDashboardDto {
  @ApiPropertyOptional({
    enum: DashboardPeriod,
    description:
      'ช่วงสำเร็จรูปนับถึงวันนี้ (สัปดาห์เริ่มวันจันทร์) · ไม่ส่ง = MONTH หรือ CUSTOM ถ้าส่ง dateFrom/dateTo',
    example: DashboardPeriod.MONTH,
  })
  @IsOptional()
  @IsEnum(DashboardPeriod, { message: 'period ต้องเป็น WEEK, MONTH, QUARTER, YEAR หรือ CUSTOM' })
  period?: DashboardPeriod;

  @ApiPropertyOptional({ description: 'ใช้กับ CUSTOM (YYYY-MM-DD)', example: '2026-07-01' })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'dateFrom ต้องอยู่ในรูปแบบ YYYY-MM-DD' })
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'ใช้กับ CUSTOM (YYYY-MM-DD) รวมวันนั้นด้วย',
    example: '2026-09-30',
  })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'dateTo ต้องอยู่ในรูปแบบ YYYY-MM-DD' })
  dateTo?: string;

  @ApiPropertyOptional({
    enum: DashboardGroupBy,
    description:
      'แบ่งกราฟเป็นช่วงละเท่าไร · ไม่ส่ง = ≤31 วันรายวัน, ≤184 วันรายสัปดาห์, นอกนั้นรายเดือน',
  })
  @IsOptional()
  @IsEnum(DashboardGroupBy, { message: 'groupBy ต้องเป็น DAY, WEEK หรือ MONTH' })
  groupBy?: DashboardGroupBy;
}
