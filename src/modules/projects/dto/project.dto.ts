import {
  ApiHideProperty,
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumberString,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { MAX_LIMIT, PaginationDto } from '../../../common/dto/pagination.dto';
import { ProjectPriority, ProjectStatus } from '../../../models';
import { CreateCustomerDto } from '../../customers/dto/create-customer.dto';

export const CREATABLE_PROJECT_STATUSES = [ProjectStatus.DRAFT, ProjectStatus.IN_PROGRESS];

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export class CreateProjectDto {
  @ApiHideProperty()
  code?: unknown;

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

  @ApiPropertyOptional({
    enum: CREATABLE_PROJECT_STATUSES,
    default: ProjectStatus.DRAFT,
    description:
      'สร้างได้แค่ DRAFT / IN_PROGRESS — DELIVERED มาจากการตรวจรับส่งมอบครั้งสุดท้าย ' +
      'สถานะอื่นเปลี่ยนตอนแก้ไขโครงการ',
  })
  @IsOptional()
  @IsIn(CREATABLE_PROJECT_STATUSES, {
    message: 'โครงการใหม่ต้องเริ่มที่สถานะร่าง (DRAFT) หรือกำลังดำเนินการ (IN_PROGRESS)',
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

export class UpdateProjectDto extends PartialType(
  OmitType(CreateProjectDto, ['newCustomer', 'status'] as const),
) {
  @ApiPropertyOptional({ readOnly: true, description: 'เปลี่ยนไม่ได้ ส่งมาจะถูกปฏิเสธ' })
  @IsOptional()
  declare customerId?: number;

  @ApiPropertyOptional({ enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus, {
    message: 'สถานะโครงการต้องเป็น DRAFT, IN_PROGRESS, DELIVERED, CLOSED หรือ CANCELLED',
  })
  status?: ProjectStatus;
}

export class QueryProjectOptionsDto {
  @ApiPropertyOptional({
    description: 'ค้นจากชื่อหรือรหัสโครงการ',
    maxLength: 100,
    example: 'คลัง',
  })
  @IsOptional()
  @IsString({ message: 'search ต้องเป็นข้อความ' })
  @MaxLength(100, { message: 'search ยาวเกินกำหนด' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @ApiPropertyOptional({
    description: `จำนวนสูงสุดที่คืน (ไม่เกิน ${MAX_LIMIT}) · ไม่ส่ง = ทั้งหมด`,
    minimum: 1,
    maximum: MAX_LIMIT,
    example: 20,
  })
  @IsOptional()
  @IsInt({ message: 'limit ต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'limit ต้องมีค่าตั้งแต่ 1 ขึ้นไป' })
  @Max(MAX_LIMIT, { message: `limit ต้องไม่เกิน ${MAX_LIMIT}` })
  limit?: number;
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
