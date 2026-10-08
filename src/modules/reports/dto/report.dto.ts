import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsPositive, Matches, Max, Min } from 'class-validator';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class ReportPeriodDto {
  @ApiPropertyOptional({
    description: 'นับตั้งแต่วันที่ (YYYY-MM-DD) — ไม่ระบุ = ไม่จำกัดย้อนหลัง',
    example: '2026-01-01',
  })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'dateFrom ต้องอยู่ในรูปแบบ YYYY-MM-DD' })
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'นับถึงวันที่ (YYYY-MM-DD) — ไม่ระบุ = ไม่จำกัด',
    example: '2026-12-31',
  })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'dateTo ต้องอยู่ในรูปแบบ YYYY-MM-DD' })
  dateTo?: string;
}

export class QueryContractValueDto extends ReportPeriodDto {
  @ApiPropertyOptional({
    description: 'เอากี่รายแรก — ไม่ระบุ = ทุกราย ใช้ limit=10 สำหรับหน้าจอจัดอันดับ',
    minimum: 1,
    maximum: 500,
    example: 10,
  })
  @IsOptional()
  @IsInt({ message: 'limit ต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'limit ต้องมีค่าตั้งแต่ 1 ขึ้นไป' })
  @Max(500, { message: 'limit ต้องไม่เกิน 500' })
  limit?: number;
}

export class QueryServiceCostDto extends ReportPeriodDto {
  @ApiPropertyOptional({ description: 'ดูเฉพาะลูกค้ารายเดียว', example: 1 })
  @IsOptional()
  @IsInt({ message: 'customerId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'customerId ต้องมากกว่า 0' })
  customerId?: number;
}

export class QueryOverlapDto {
  @ApiPropertyOptional({
    description: 'ตรวจเฉพาะลูกค้ารายเดียว — ไม่ระบุ = ตรวจทุกราย',
    example: 1,
  })
  @IsOptional()
  @IsInt({ message: 'customerId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'customerId ต้องมากกว่า 0' })
  customerId?: number;
}
