import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumberString,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { PaginationDto } from '../../../common/dto/pagination.dto';
import { ProjectPriority, ProjectStatus } from '../../../models';
import { CreateCustomerDto } from '../../customers/dto/create-customer.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * สร้างโครงการ — ระบุลูกค้าได้สองแบบ **อย่างใดอย่างหนึ่ง** (ประชุม 11 ก.ย. — B-3)
 *
 *   customerId   ลูกค้าเดิม (หน้าจอค้นจากชื่อเมื่อพิมพ์ 2–3 ตัว)
 *   newCustomer  ลูกค้าใหม่ กรอกในฟอร์มเดียวกัน ระบบบันทึกลูกค้ากับโครงการในทรานแซกชันเดียว
 *
 * พี่เลี้ยง: "ทำงานครั้งเดียวจบ" ไม่ต้องไปเพิ่มลูกค้าที่เมนูลูกค้าก่อนแล้วค่อยกลับมาสร้างโครงการ
 * ส่ง newCustomer ต้องมีสิทธิ์ `customer.create` เพิ่มจาก `project.create` ด้วย
 */
export class CreateProjectDto {
  @ApiPropertyOptional({
    description: 'ลูกค้าเดิมที่เป็นเจ้าของโครงการ — ส่งค่านี้ หรือ newCustomer อย่างใดอย่างหนึ่ง',
    example: 1,
  })
  @IsOptional()
  @IsInt({ message: 'customerId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'customerId ต้องมากกว่า 0' })
  customerId?: number;

  @ApiPropertyOptional({
    type: () => CreateCustomerDto,
    description:
      'ลูกค้าใหม่ กรอกพร้อมโครงการในครั้งเดียว — ฟิลด์เหมือน POST /api/customers ทุกตัว ' +
      'บันทึกพร้อมโครงการในทรานแซกชันเดียว ต้องมีสิทธิ์ customer.create ด้วย',
  })
  @IsOptional()
  @IsObject({ message: 'newCustomer ต้องเป็นข้อมูลลูกค้า' })
  @ValidateNested()
  @Type(() => CreateCustomerDto)
  newCustomer?: CreateCustomerDto;

  @ApiProperty({ description: 'ชื่อโครงการ', maxLength: 255, example: 'ระบบจัดการคลังสินค้า' })
  @IsString({ message: 'ชื่อโครงการต้องเป็นข้อความ' })
  @IsNotEmpty({ message: 'กรุณากรอกชื่อโครงการ' })
  @MaxLength(255, { message: 'ชื่อโครงการยาวเกิน 255 ตัวอักษร' })
  @Transform(trim)
  name: string;

  @ApiPropertyOptional({
    description: 'รหัสโครงการที่บริษัทกำหนดเอง',
    maxLength: 50,
    example: 'PRJ-2026-001',
  })
  @IsOptional()
  @IsString({ message: 'รหัสโครงการต้องเป็นข้อความ' })
  @MaxLength(50, { message: 'รหัสโครงการยาวเกิน 50 ตัวอักษร' })
  @Transform(trimToNull)
  code?: string | null;

  @ApiPropertyOptional({ description: 'รายละเอียดโครงการ' })
  @IsOptional()
  @IsString({ message: 'รายละเอียดต้องเป็นข้อความ' })
  @Transform(trimToNull)
  description?: string | null;

  @ApiPropertyOptional({ description: 'ประเภทงาน เช่น SOFTWARE, HARDWARE, IOT', maxLength: 100 })
  @IsOptional()
  @IsString({ message: 'ประเภทงานต้องเป็นข้อความ' })
  @MaxLength(100, { message: 'ประเภทงานยาวเกิน 100 ตัวอักษร' })
  @Transform(trimToNull)
  projectType?: string | null;

  @ApiPropertyOptional({ enum: ProjectStatus, default: ProjectStatus.DRAFT })
  @IsOptional()
  @IsEnum(ProjectStatus, {
    message: 'สถานะโครงการต้องเป็น DRAFT, IN_PROGRESS, DELIVERED, CLOSED หรือ CANCELLED',
  })
  status?: ProjectStatus;

  @ApiPropertyOptional({ enum: ProjectPriority, default: ProjectPriority.NORMAL })
  @IsOptional()
  @IsEnum(ProjectPriority, { message: 'ความสำคัญต้องเป็น LOW, NORMAL, HIGH หรือ URGENT' })
  priority?: ProjectPriority;

  @ApiPropertyOptional({ description: 'วันเริ่มโครงการ (YYYY-MM-DD)', example: '2026-09-01' })
  @IsOptional()
  @IsISO8601({}, { message: 'startDate ต้องเป็นวันที่รูปแบบ YYYY-MM-DD' })
  startDate?: string | null;

  @ApiPropertyOptional({ description: 'กำหนดส่งมอบตามแผน (YYYY-MM-DD)', example: '2026-12-31' })
  @IsOptional()
  @IsISO8601({}, { message: 'targetEndDate ต้องเป็นวันที่รูปแบบ YYYY-MM-DD' })
  targetEndDate?: string | null;

  @ApiPropertyOptional({ description: 'วันที่ปิดโครงการจริง (YYYY-MM-DD)' })
  @IsOptional()
  @IsISO8601({}, { message: 'actualEndDate ต้องเป็นวันที่รูปแบบ YYYY-MM-DD' })
  actualEndDate?: string | null;

  @ApiPropertyOptional({
    description: 'มูลค่าสัญญา ส่งเป็นสตริงตัวเลขเพื่อไม่ให้เสียความละเอียดทศนิยม',
    example: '1500000.00',
  })
  @IsOptional()
  @IsNumberString({ no_symbols: false }, { message: 'มูลค่าสัญญาต้องเป็นตัวเลข' })
  contractValue?: string | null;

  @ApiPropertyOptional({
    description:
      'จำนวนฟังก์ชันของโครงการ — ใช้เป็นตัวตั้งคิดราคา MA ภายหลัง คู่กับมูลค่าสัญญา ' +
      'เนื้อหาแผน MA เหมือนกันทุกโครงการ แต่ราคาต่างกัน (BR-05)',
    example: 42,
  })
  @IsOptional()
  @IsInt({ message: 'functionCount ต้องเป็นจำนวนเต็ม' })
  @Min(0, { message: 'functionCount ต้องไม่ติดลบ' })
  functionCount?: number | null;

  @ApiPropertyOptional({ description: 'พนักงานที่เป็นผู้จัดการโครงการ', example: 3 })
  @IsOptional()
  @IsInt({ message: 'managerUserId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'managerUserId ต้องมากกว่า 0' })
  managerUserId?: number | null;
}

/**
 * ย้ายโครงการข้ามลูกค้าไม่ได้ — ประวัติ ticket และสัญญา MA ผูกกับลูกค้าเดิมไปแล้ว
 * ไม่มี newCustomer เพราะการสร้างลูกค้าใหม่ตอนแก้ไขคือการย้ายลูกค้าในอีกรูปแบบหนึ่ง
 */
export class UpdateProjectDto extends PartialType(
  OmitType(CreateProjectDto, ['newCustomer'] as const),
) {
  @ApiPropertyOptional({ readOnly: true, description: 'เปลี่ยนไม่ได้ ส่งมาจะถูกปฏิเสธ' })
  @IsOptional()
  declare customerId?: number;
}

export class QueryProjectsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ProjectStatus, description: 'กรองตามสถานะ' })
  @IsOptional()
  @IsEnum(ProjectStatus, {
    message: 'สถานะโครงการต้องเป็น DRAFT, IN_PROGRESS, DELIVERED, CLOSED หรือ CANCELLED',
  })
  status?: ProjectStatus;

  @ApiPropertyOptional({ description: 'กรองเฉพาะโครงการของลูกค้ารายนี้', example: 1 })
  @IsOptional()
  @IsInt({ message: 'customerId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'customerId ต้องมากกว่า 0' })
  customerId?: number;

  @ApiPropertyOptional({ enum: ProjectPriority, description: 'กรองตามความสำคัญ' })
  @IsOptional()
  @IsEnum(ProjectPriority, { message: 'ความสำคัญต้องเป็น LOW, NORMAL, HIGH หรือ URGENT' })
  priority?: ProjectPriority;

  @ApiPropertyOptional({ description: 'กรองเฉพาะโครงการที่พนักงานคนนี้เป็นผู้จัดการ', example: 3 })
  @IsOptional()
  @IsInt({ message: 'managerUserId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'managerUserId ต้องมากกว่า 0' })
  managerUserId?: number;
}
