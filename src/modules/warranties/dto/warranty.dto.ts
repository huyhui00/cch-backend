import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsPositive, IsString, Max, Min } from 'class-validator';

import { PaginationDto } from '../../../common/dto/pagination.dto';
import { WarrantyStatus } from '../../../models';

const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** ระยะประกันที่ยาวเกินนี้แทบจะเป็นการพิมพ์ผิดเสมอ (10 ปี) */
const MAX_DURATION_MONTH = 120;

/**
 * BR-06 — ระยะประกันนับจากวันส่งมอบ
 *
 * ไม่มี startDate / endDate / projectId ให้กรอกโดยเจตนา ทั้งสามค่าคำนวณจาก delivery
 * ที่ระบุใน path เสมอ ถ้าเปิดให้กรอกเอง กฎ "นับจากวันส่งมอบ" จะกลายเป็นแค่คำแนะนำ
 */
export class CreateWarrantyDto {
  @ApiProperty({
    description:
      'ระยะประกันเป็นเดือน นับจากวันส่งมอบ — ค่าที่ใช้กันจริงคือ 6 หรือ 12 ' +
      'แต่ระบบไม่ได้บังคับไว้แค่สองค่านี้ เผื่อดีลที่ตกลงกันเป็นอย่างอื่น',
    minimum: 1,
    maximum: MAX_DURATION_MONTH,
    example: 12,
  })
  @IsInt({ message: 'durationMonth ต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'ระยะประกันต้องมีอย่างน้อย 1 เดือน' })
  @Max(MAX_DURATION_MONTH, { message: `ระยะประกันต้องไม่เกิน ${MAX_DURATION_MONTH} เดือน` })
  durationMonth: number;

  @ApiPropertyOptional({
    description:
      'ขอบเขตที่ประกันครอบคลุม — ประกันครอบคลุมเฉพาะ bug ในขอบเขตเดิม ' +
      'เพิ่มฟีเจอร์ใหม่คิดเงินใหม่ (BR-07) ระบบเก็บข้อความนี้ไว้ให้คนอ่านประกอบการตัดสินใจ ' +
      'ไม่ได้เอาไปบังคับใช้อัตโนมัติ',
    example: 'ครอบคลุมข้อผิดพลาดของฟังก์ชันตามเอกสารข้อกำหนด v1.0 ไม่รวมการเพิ่มรายงานใหม่',
  })
  @IsOptional()
  @IsString({ message: 'ขอบเขตการรับประกันต้องเป็นข้อความ' })
  @Transform(trimToNull)
  scopeNote?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'สัญญา MA ที่ประกันใบนี้มาคู่กัน (B-13) — ต้องเป็นสัญญาของโครงการเดียวกัน ' +
      'ไม่บังคับกรอก และเป็นการอ้างอิงอย่างเดียว ไม่มีการรวมโควตาหรือรวมราคาใด ๆ ' +
      'ประกันยังมาก่อนสัญญา MA ในการเสนอประเภทการคิดเงินเหมือนเดิม',
    example: 3,
  })
  @IsOptional()
  @IsInt({ message: 'maContractId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'maContractId ต้องมากกว่า 0' })
  maContractId?: number | null;
}

/**
 * แก้ไขการรับประกัน
 *
 * แก้ durationMonth ได้ แล้ว endDate จะถูกคำนวณใหม่จาก startDate เดิมเสมอ
 * ส่วน startDate แก้ไม่ได้เพราะผูกกับวันส่งมอบตาม BR-06 ถ้าวันส่งมอบผิด
 * ให้ไปแก้ที่ใบส่งมอบ แล้วระบบจะขยับ startDate ของประกันตามให้เอง
 */
export class UpdateWarrantyDto {
  @ApiPropertyOptional({
    description: 'ระยะประกันใหม่เป็นเดือน — endDate จะถูกคำนวณใหม่จากวันส่งมอบเดิม',
    minimum: 1,
    maximum: MAX_DURATION_MONTH,
    example: 12,
  })
  @IsOptional()
  @IsInt({ message: 'durationMonth ต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'ระยะประกันต้องมีอย่างน้อย 1 เดือน' })
  @Max(MAX_DURATION_MONTH, { message: `ระยะประกันต้องไม่เกิน ${MAX_DURATION_MONTH} เดือน` })
  durationMonth?: number;

  @ApiPropertyOptional({
    enum: [WarrantyStatus.ACTIVE, WarrantyStatus.VOID],
    description:
      'ตั้งได้แค่ ACTIVE หรือ VOID (ยกเลิก) — EXPIRED ระบบตั้งให้เองเมื่อเลยวันสิ้นสุด ส่งมาจะได้ 400',
  })
  @IsOptional()
  @IsEnum(WarrantyStatus, { message: 'สถานะการรับประกันต้องเป็น ACTIVE, EXPIRED หรือ VOID' })
  status?: WarrantyStatus;

  @ApiPropertyOptional({ description: 'ขอบเขตที่ประกันครอบคลุม (BR-07)' })
  @IsOptional()
  @IsString({ message: 'ขอบเขตการรับประกันต้องเป็นข้อความ' })
  @Transform(trimToNull)
  scopeNote?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'สัญญา MA ที่ผูกกับประกันใบนี้ (B-13) — ส่ง null เพื่อถอดการผูกออกเมื่อผูกผิดฉบับ ' +
      'ไม่ส่งมาเลย = คงค่าเดิม · ต้องเป็นสัญญาของโครงการเดียวกันกับประกัน',
    example: 3,
  })
  @IsOptional()
  @IsInt({ message: 'maContractId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'maContractId ต้องมากกว่า 0' })
  maContractId?: number | null;
}

export class QueryWarrantiesDto extends PaginationDto {
  @ApiPropertyOptional({ enum: WarrantyStatus, description: 'กรองตามสถานะที่บันทึกไว้' })
  @IsOptional()
  @IsEnum(WarrantyStatus, { message: 'สถานะการรับประกันต้องเป็น ACTIVE, EXPIRED หรือ VOID' })
  status?: WarrantyStatus;

  @ApiPropertyOptional({ description: 'กรองเฉพาะประกันของการส่งมอบครั้งนี้', example: 5 })
  @IsOptional()
  @IsInt({ message: 'deliveryId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'deliveryId ต้องมากกว่า 0' })
  deliveryId?: number;
}

/** หน้าจอ "ประกันใกล้หมด" — ตัวป้อนให้ notification rule แบบ WARRANTY_EXPIRING ใน Phase 11 */
export class QueryExpiringWarrantiesDto extends PaginationDto {
  @ApiPropertyOptional({
    description:
      'ดูล่วงหน้ากี่วัน นับจากวันนี้ — ประกันที่หมดอายุไปแล้วไม่ถูกนับรวม ' +
      'เพราะหน้าจอนี้มีไว้ให้ไล่ต่อสัญญาทัน ไม่ใช่ไว้ดูของที่สายไปแล้ว',
    minimum: 1,
    maximum: 365,
    default: 30,
    example: 30,
  })
  @IsOptional()
  @IsInt({ message: 'days ต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'days ต้องมีค่าตั้งแต่ 1 ขึ้นไป' })
  @Max(365, { message: 'days ต้องไม่เกิน 365' })
  days: number = 30;

  @ApiPropertyOptional({ description: 'กรองเฉพาะประกันของลูกค้ารายนี้', example: 1 })
  @IsOptional()
  @IsInt({ message: 'customerId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'customerId ต้องมากกว่า 0' })
  customerId?: number;
}
