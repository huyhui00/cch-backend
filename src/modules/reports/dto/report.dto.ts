import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsPositive, Matches, Max, Min } from 'class-validator';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ช่วงเวลาที่ใช้กรองรายงาน
 *
 * กรองด้วย "วันที่เริ่มสัญญา" ของแต่ละรายการ ไม่ใช่วันที่บันทึกเข้าระบบ
 * เพราะข้อมูลย้อนหลังถูกคีย์เข้ามาทีหลัง (บริษัทเก็บเป็นกระดาษมา 4 ปี)
 * ถ้ากรองด้วย created_at ตัวเลขจะกองอยู่ที่วันที่คีย์ข้อมูล ไม่ใช่วันที่เกิดจริง
 */
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

/**
 * M10-01 มูลค่าตามสัญญาแยกรายลูกค้า และ M10-03 จัดอันดับ
 *
 * เป็นข้อมูลชุดเดียวกัน ต่างกันแค่จำนวนแถวที่เอา — จัดอันดับคือเอาเฉพาะหัวตาราง
 * จึงใช้ endpoint เดียวแล้วให้ `limit` เป็นตัวแยก ไม่ต้องมีสองเส้นที่คืนของเหมือนกัน
 */
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

/** M10-05 ต้นทุนการให้บริการ */
export class QueryServiceCostDto extends ReportPeriodDto {
  @ApiPropertyOptional({ description: 'ดูเฉพาะลูกค้ารายเดียว', example: 1 })
  @IsOptional()
  @IsInt({ message: 'customerId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'customerId ต้องมากกว่า 0' })
  customerId?: number;
}

/** ตรวจสัญญา MA ที่ช่วงเวลาซ้อนทับกัน */
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
