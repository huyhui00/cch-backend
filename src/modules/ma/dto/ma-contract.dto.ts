import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { PaginationDto } from '../../../common/dto/pagination.dto';
import { MaAddonType, MaBillingCycle, MaContractStatus } from '../../../models';

const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * ราคาเป็นข้อความไม่ใช่ number โดยเจตนา
 *
 * `DECIMAL(15,2)` ของ MySQL เก็บได้ละเอียดกว่า `number` ของ JavaScript
 * ถ้ารับเป็น number ค่าอย่าง 12345678901.55 จะถูกปัดตั้งแต่ยังไม่ถึงฐานข้อมูล
 * และ Sequelize เองก็คืน DECIMAL กลับมาเป็น string อยู่แล้ว รับเป็น string
 * ตั้งแต่ต้นทางจึงทำให้ค่าไป-กลับเป็นชนิดเดียวกันตลอดสาย
 */
const MONEY_PATTERN = /^\d{1,13}(\.\d{1,2})?$/;

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class CreateMaContractDto {
  @ApiProperty({
    description:
      'โครงการที่สัญญาฉบับนี้ดูแล — สัญญา MA ผูกกับโครงการเสมอ ไม่ใช่ผูกกับลูกค้าลอย ๆ ' +
      'ลูกค้าถูกดึงมาจากโครงการให้เอง จึงไม่ต้องส่ง customerId มา',
    example: 3,
  })
  @IsInt({ message: 'projectId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'projectId ต้องมากกว่า 0' })
  projectId: number;

  @ApiProperty({ description: 'แผน MA ที่ใช้เป็นเนื้อหาของสัญญา (BR-05)', example: 2 })
  @IsInt({ message: 'planId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'planId ต้องมากกว่า 0' })
  planId: number;

  @ApiProperty({
    description:
      'ราคาตามสัญญา ส่งเป็นข้อความทศนิยมไม่เกิน 2 ตำแหน่ง — ' +
      'ราคาอยู่ที่สัญญาไม่ใช่ที่แผน เพราะเนื้อหาเหมือนกันแต่ราคาต่างกันได้ (BR-05)',
    example: '48000.00',
  })
  @IsString({ message: 'ราคาต้องส่งมาเป็นข้อความ' })
  @Matches(MONEY_PATTERN, {
    message: 'ราคาต้องเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง',
  })
  @Transform(trim)
  price: string;

  @ApiPropertyOptional({
    description: 'รอบการวางบิล — ไม่เกี่ยวกับรอบโควตา โควตานับรายเดือนเสมอ (Q3)',
    enum: MaBillingCycle,
    default: MaBillingCycle.YEARLY,
  })
  @IsOptional()
  @IsEnum(MaBillingCycle, { message: 'รอบการวางบิลต้องเป็น MONTHLY หรือ YEARLY' })
  billingCycle?: MaBillingCycle;

  @ApiProperty({
    description:
      'วันเริ่มสัญญา (YYYY-MM-DD) — เป็นวันตั้งต้นของรอบโควตาด้วย ' +
      'สัญญาที่เริ่มวันที่ 15 จะรีเซ็ตโควตาทุกวันที่ 15 (Q2)',
    example: '2026-10-01',
  })
  @Matches(DATE_ONLY_PATTERN, { message: 'วันเริ่มสัญญาต้องอยู่ในรูปแบบ YYYY-MM-DD' })
  startDate: string;

  @ApiProperty({ description: 'วันสิ้นสุดสัญญา (YYYY-MM-DD)', example: '2027-09-30' })
  @Matches(DATE_ONLY_PATTERN, { message: 'วันสิ้นสุดสัญญาต้องอยู่ในรูปแบบ YYYY-MM-DD' })
  endDate: string;

  @ApiPropertyOptional({
    description:
      'สถานะเริ่มต้น — ค่าปกติคือ DRAFT แล้วค่อยเปลี่ยนเป็น ACTIVE เมื่อเซ็นสัญญาแล้ว ' +
      'RENEWED ตั้งเองไม่ได้ ระบบตั้งให้ฉบับเดิมตอนต่อสัญญา',
    enum: [
      MaContractStatus.DRAFT,
      MaContractStatus.ACTIVE,
      MaContractStatus.EXPIRED,
      MaContractStatus.CANCELLED,
    ],
    default: MaContractStatus.DRAFT,
  })
  @IsOptional()
  @IsEnum(MaContractStatus, { message: 'สถานะสัญญาไม่ถูกต้อง' })
  status?: MaContractStatus;

  @ApiPropertyOptional({
    description: 'เลขที่สัญญา ห้ามซ้ำ',
    maxLength: 100,
    example: 'MA-2026-014',
  })
  @IsOptional()
  @IsString({ message: 'เลขที่สัญญาต้องเป็นข้อความ' })
  @MaxLength(100, { message: 'เลขที่สัญญายาวเกิน 100 ตัวอักษร' })
  @Transform(trimToNull)
  contractNo?: string | null;

  @ApiPropertyOptional({
    description: 'วันที่เซ็นสัญญา (YYYY-MM-DD) — สัญญาเซ็นมือแล้วสแกนเข้าระบบ (BR-12)',
    example: '2026-09-25',
  })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'วันที่เซ็นสัญญาต้องอยู่ในรูปแบบ YYYY-MM-DD' })
  @Transform(trimToNull)
  signedDate?: string | null;

  @ApiPropertyOptional({
    description: 'ลิงก์ไฟล์สัญญาที่สแกนแล้ว — การอัปโหลดจริงเป็นของโมดูล Files ใน Phase 9',
    maxLength: 500,
  })
  @IsOptional()
  @IsString({ message: 'ลิงก์ไฟล์สัญญาต้องเป็นข้อความ' })
  @MaxLength(500, { message: 'ลิงก์ไฟล์สัญญายาวเกิน 500 ตัวอักษร' })
  @Transform(trimToNull)
  signedFileUrl?: string | null;

  @ApiPropertyOptional({ description: 'บันทึกเพิ่มเติม' })
  @IsOptional()
  @IsString({ message: 'บันทึกเพิ่มเติมต้องเป็นข้อความ' })
  @Transform(trimToNull)
  note?: string | null;
}

/**
 * แก้ไขสัญญา
 *
 * ย้ายโครงการไม่ได้ (ไม่มี `projectId`) ด้วยเหตุผลเดียวกับที่ย้ายโครงการข้ามลูกค้าไม่ได้
 * ใน Phase 5 — สัญญาที่หักโควตาไปแล้วจะพาประวัติการใช้งานไปโผล่ผิดโครงการ
 * ถ้าผูกผิดโครงการจริง ให้ยกเลิกฉบับนั้น (CANCELLED) แล้วทำฉบับใหม่
 */
export class UpdateMaContractDto {
  @ApiPropertyOptional({ description: 'เปลี่ยนแผนที่ใช้ได้ถ้ายังไม่มีการหักโควตา', example: 2 })
  @IsOptional()
  @IsInt({ message: 'planId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'planId ต้องมากกว่า 0' })
  planId?: number;

  @ApiPropertyOptional({ description: 'ราคาตามสัญญา', example: '52000.00' })
  @IsOptional()
  @IsString({ message: 'ราคาต้องส่งมาเป็นข้อความ' })
  @Matches(MONEY_PATTERN, { message: 'ราคาต้องเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง' })
  @Transform(trim)
  price?: string;

  @ApiPropertyOptional({ enum: MaBillingCycle })
  @IsOptional()
  @IsEnum(MaBillingCycle, { message: 'รอบการวางบิลต้องเป็น MONTHLY หรือ YEARLY' })
  billingCycle?: MaBillingCycle;

  @ApiPropertyOptional({
    description: 'แก้วันเริ่มสัญญาได้ก่อนที่จะมีการหักโควตา เพราะเป็นวันตั้งต้นของรอบโควตา (Q2)',
    example: '2026-10-15',
  })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'วันเริ่มสัญญาต้องอยู่ในรูปแบบ YYYY-MM-DD' })
  startDate?: string;

  @ApiPropertyOptional({ example: '2027-10-14' })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'วันสิ้นสุดสัญญาต้องอยู่ในรูปแบบ YYYY-MM-DD' })
  endDate?: string;

  @ApiPropertyOptional({
    description: 'RENEWED ตั้งเองไม่ได้ ระบบตั้งให้ฉบับเดิมตอนต่อสัญญาผ่าน POST /:id/renew',
    enum: [
      MaContractStatus.DRAFT,
      MaContractStatus.ACTIVE,
      MaContractStatus.EXPIRED,
      MaContractStatus.CANCELLED,
    ],
  })
  @IsOptional()
  @IsEnum(MaContractStatus, { message: 'สถานะสัญญาไม่ถูกต้อง' })
  status?: MaContractStatus;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString({ message: 'เลขที่สัญญาต้องเป็นข้อความ' })
  @MaxLength(100, { message: 'เลขที่สัญญายาวเกิน 100 ตัวอักษร' })
  @Transform(trimToNull)
  contractNo?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'วันที่เซ็นสัญญาต้องอยู่ในรูปแบบ YYYY-MM-DD' })
  @Transform(trimToNull)
  signedDate?: string | null;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString({ message: 'ลิงก์ไฟล์สัญญาต้องเป็นข้อความ' })
  @MaxLength(500, { message: 'ลิงก์ไฟล์สัญญายาวเกิน 500 ตัวอักษร' })
  @Transform(trimToNull)
  signedFileUrl?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'บันทึกเพิ่มเติมต้องเป็นข้อความ' })
  @Transform(trimToNull)
  note?: string | null;
}

/**
 * ต่อสัญญา — สร้างฉบับใหม่แล้วปิดฉบับเดิมเป็น RENEWED ในทรานแซกชันเดียว
 *
 * ไม่ต้องส่ง projectId / planId เพราะคัดลอกจากฉบับเดิม ถ้าจะเปลี่ยนแผนตอนต่อสัญญา
 * ให้ส่ง planId มาทับได้ ส่วนราคาส่งใหม่เสมอเพราะการต่อสัญญาคือจุดที่ราคาเปลี่ยน
 */
export class RenewMaContractDto {
  @ApiProperty({ description: 'วันเริ่มของสัญญาฉบับใหม่', example: '2027-10-01' })
  @Matches(DATE_ONLY_PATTERN, { message: 'วันเริ่มสัญญาต้องอยู่ในรูปแบบ YYYY-MM-DD' })
  startDate: string;

  @ApiProperty({ description: 'วันสิ้นสุดของสัญญาฉบับใหม่', example: '2028-09-30' })
  @Matches(DATE_ONLY_PATTERN, { message: 'วันสิ้นสุดสัญญาต้องอยู่ในรูปแบบ YYYY-MM-DD' })
  endDate: string;

  @ApiProperty({ description: 'ราคาของฉบับใหม่', example: '52000.00' })
  @IsString({ message: 'ราคาต้องส่งมาเป็นข้อความ' })
  @Matches(MONEY_PATTERN, { message: 'ราคาต้องเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง' })
  @Transform(trim)
  price: string;

  @ApiPropertyOptional({ description: 'เปลี่ยนแผนตอนต่อสัญญา — ไม่ส่ง = ใช้แผนเดิม' })
  @IsOptional()
  @IsInt({ message: 'planId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'planId ต้องมากกว่า 0' })
  planId?: number;

  @ApiPropertyOptional({ enum: MaBillingCycle, description: 'ไม่ส่ง = ใช้รอบเดิม' })
  @IsOptional()
  @IsEnum(MaBillingCycle, { message: 'รอบการวางบิลต้องเป็น MONTHLY หรือ YEARLY' })
  billingCycle?: MaBillingCycle;

  @ApiPropertyOptional({ maxLength: 100, description: 'เลขที่สัญญาของฉบับใหม่' })
  @IsOptional()
  @IsString({ message: 'เลขที่สัญญาต้องเป็นข้อความ' })
  @MaxLength(100, { message: 'เลขที่สัญญายาวเกิน 100 ตัวอักษร' })
  @Transform(trimToNull)
  contractNo?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'บันทึกเพิ่มเติมต้องเป็นข้อความ' })
  @Transform(trimToNull)
  note?: string | null;
}

export class QueryMaContractsDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'กรองตามลูกค้า', example: 1 })
  @IsOptional()
  @IsInt({ message: 'customerId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'customerId ต้องมากกว่า 0' })
  customerId?: number;

  @ApiPropertyOptional({ description: 'กรองตามโครงการ', example: 3 })
  @IsOptional()
  @IsInt({ message: 'projectId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'projectId ต้องมากกว่า 0' })
  projectId?: number;

  @ApiPropertyOptional({ enum: MaContractStatus, description: 'กรองตามสถานะสัญญา' })
  @IsOptional()
  @IsEnum(MaContractStatus, { message: 'สถานะสัญญาไม่ถูกต้อง' })
  status?: MaContractStatus;

  @ApiPropertyOptional({
    description:
      'สัญญาที่หมดอายุภายในกี่วันข้างหน้า — หน้าจอ "สัญญาใกล้หมดอายุ" ' +
      'นับเฉพาะฉบับที่ยัง ACTIVE และยังไม่หมดอายุ',
    minimum: 1,
    maximum: 365,
    example: 30,
  })
  @IsOptional()
  @IsInt({ message: 'expiringInDays ต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'expiringInDays ต้องมีค่าตั้งแต่ 1 ขึ้นไป' })
  @Max(365, { message: 'expiringInDays ต้องไม่เกิน 365' })
  expiringInDays?: number;
}

export class CreateMaAddonDto {
  @ApiProperty({ description: 'ชื่อของเสริม', maxLength: 255, example: 'ซื้อโควตาเพิ่ม 3 ครั้ง' })
  @IsString({ message: 'ชื่อของเสริมต้องเป็นข้อความ' })
  @MaxLength(255, { message: 'ชื่อของเสริมยาวเกิน 255 ตัวอักษร' })
  @Transform(trim)
  title: string;

  @ApiPropertyOptional({ enum: MaAddonType, default: MaAddonType.EXTRA_QUOTA })
  @IsOptional()
  @IsEnum(MaAddonType, { message: 'ประเภทของเสริมต้องเป็น EXTRA_QUOTA หรือ OTHER' })
  addonType?: MaAddonType;

  @ApiPropertyOptional({
    description: 'โควตาที่เพิ่มให้ — ถูกนำไปบวกกับโควตาของแผนตอนคำนวณ (CLAUDE.md 9.2)',
    minimum: 0,
    maximum: 999,
    default: 0,
    example: 3,
  })
  @IsOptional()
  @IsInt({ message: 'โควตาที่เพิ่มต้องเป็นจำนวนเต็ม' })
  @Min(0, { message: 'โควตาที่เพิ่มต้องไม่ติดลบ' })
  @Max(999, { message: 'โควตาที่เพิ่มต้องไม่เกิน 999' })
  extraQuota?: number;

  @ApiPropertyOptional({ description: 'ราคาของเสริม', default: '0', example: '4500.00' })
  @IsOptional()
  @IsString({ message: 'ราคาต้องส่งมาเป็นข้อความ' })
  @Matches(MONEY_PATTERN, { message: 'ราคาต้องเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง' })
  @Transform(trim)
  price?: string;

  @ApiPropertyOptional({
    description:
      'ปีของรอบที่ของเสริมนี้มีผล — ต้องส่งคู่กับ effectiveMonth ' +
      'ไม่ส่งทั้งคู่ = มีผลตลอดอายุสัญญา',
    minimum: 2000,
    maximum: 2999,
    example: 2026,
  })
  @IsOptional()
  @IsInt({ message: 'effectiveYear ต้องเป็นจำนวนเต็ม' })
  @Min(2000, { message: 'effectiveYear ต้องอยู่ระหว่าง 2000 ถึง 2999' })
  @Max(2999, { message: 'effectiveYear ต้องอยู่ระหว่าง 2000 ถึง 2999' })
  effectiveYear?: number | null;

  @ApiPropertyOptional({
    description: 'เดือนของรอบที่ของเสริมนี้มีผล (1-12) ต้องส่งคู่กับ effectiveYear',
    minimum: 1,
    maximum: 12,
    example: 11,
  })
  @IsOptional()
  @IsInt({ message: 'effectiveMonth ต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'effectiveMonth ต้องอยู่ระหว่าง 1 ถึง 12' })
  @Max(12, { message: 'effectiveMonth ต้องอยู่ระหว่าง 1 ถึง 12' })
  effectiveMonth?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'บันทึกเพิ่มเติมต้องเป็นข้อความ' })
  @Transform(trimToNull)
  note?: string | null;
}

/** ดูสถานะโควตาของรอบที่วันที่กำหนดตกอยู่ — ไม่ระบุ = รอบปัจจุบัน */
export class QueryQuotaDto {
  @ApiPropertyOptional({
    description: 'ดูโควตาของรอบที่วันที่นี้ตกอยู่ (ISO 8601) — ไม่ระบุ = วันนี้',
    example: '2026-11-20T00:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601({}, { message: 'วันที่ต้องอยู่ในรูปแบบ ISO 8601' })
  onDate?: string;
}
