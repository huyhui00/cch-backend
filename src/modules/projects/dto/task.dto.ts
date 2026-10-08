import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { PaginationDto } from '../../../common/dto/pagination.dto';
import { TaskPriority, TaskStatus } from '../../../models';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export class CreateTaskDto {
  @ApiProperty({ description: 'ชื่องาน', maxLength: 255, example: 'ออกแบบหน้าจอรับสินค้าเข้าคลัง' })
  @IsString({ message: 'ชื่องานต้องเป็นข้อความ' })
  @IsNotEmpty({ message: 'กรุณากรอกชื่องาน' })
  @MaxLength(255, { message: 'ชื่องานยาวเกิน 255 ตัวอักษร' })
  @Transform(trim)
  title: string;

  @ApiPropertyOptional({
    description:
      'งานแม่ ถ้าต้องการให้เป็นงานย่อย — งานแม่ต้องอยู่ในโครงการเดียวกัน ' +
      'ระดับฐานข้อมูลซ้อนได้ไม่จำกัดชั้น แต่ API คืนโครงสร้างซ้อนให้ 2 ระดับเป็นค่าเริ่มต้น',
    example: 5,
  })
  @IsOptional()
  @IsInt({ message: 'parentTaskId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'parentTaskId ต้องมากกว่า 0' })
  parentTaskId?: number | null;

  @ApiPropertyOptional({ description: 'รายละเอียดงาน' })
  @IsOptional()
  @IsString({ message: 'รายละเอียดต้องเป็นข้อความ' })
  @Transform(trimToNull)
  description?: string | null;

  @ApiPropertyOptional({ enum: TaskStatus, default: TaskStatus.TODO })
  @IsOptional()
  @IsEnum(TaskStatus, { message: 'สถานะงานต้องเป็น TODO, DOING, WAITING, REVIEW หรือ DONE' })
  status?: TaskStatus;

  @ApiPropertyOptional({
    enum: TaskPriority,
    default: TaskPriority.NORMAL,
    description: 'งานที่ต้องทำก่อนให้ตั้งค่านี้ให้สูง ระบบไม่บังคับลำดับการทำงานให้',
  })
  @IsOptional()
  @IsEnum(TaskPriority, { message: 'ความสำคัญต้องเป็น LOW, NORMAL, HIGH หรือ URGENT' })
  priority?: TaskPriority;

  @ApiPropertyOptional({ description: 'พนักงานที่รับผิดชอบงานนี้', example: 3 })
  @IsOptional()
  @IsInt({ message: 'assignedUserId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'assignedUserId ต้องมากกว่า 0' })
  assignedUserId?: number | null;

  @ApiPropertyOptional({ description: 'วันเริ่มงาน (YYYY-MM-DD)', example: '2026-09-10' })
  @IsOptional()
  @IsISO8601({}, { message: 'startDate ต้องเป็นวันที่รูปแบบ YYYY-MM-DD' })
  startDate?: string | null;

  @ApiPropertyOptional({ description: 'วันครบกำหนด (YYYY-MM-DD)', example: '2026-09-20' })
  @IsOptional()
  @IsISO8601({}, { message: 'dueDate ต้องเป็นวันที่รูปแบบ YYYY-MM-DD' })
  dueDate?: string | null;

  @ApiPropertyOptional({ description: 'ชั่วโมงที่ประเมินไว้', example: '16.00' })
  @IsOptional()
  @IsNumberString({ no_symbols: false }, { message: 'estimatedHours ต้องเป็นตัวเลข' })
  estimatedHours?: string | null;

  @ApiPropertyOptional({ description: 'ชั่วโมงที่ใช้จริง', example: '18.50' })
  @IsOptional()
  @IsNumberString({ no_symbols: false }, { message: 'actualHours ต้องเป็นตัวเลข' })
  actualHours?: string | null;

  @ApiPropertyOptional({
    description: 'ลำดับการแสดงผลในกลุ่มพี่น้องเดียวกัน ถ้าไม่ส่งจะถูกต่อท้ายให้อัตโนมัติ',
    example: 0,
  })
  @IsOptional()
  @IsInt({ message: 'sortOrder ต้องเป็นจำนวนเต็ม' })
  @Min(0, { message: 'sortOrder ต้องไม่ติดลบ' })
  sortOrder?: number;
}

export class UpdateTaskDto extends PartialType(CreateTaskDto) {}

export class UpdateTaskStatusDto {
  @ApiProperty({
    enum: TaskStatus,
    description:
      'เปลี่ยนไปสถานะใดก็ได้ ระบบไม่บังคับลำดับ เพราะงานจริงถอยกลับได้ ' +
      '(เช่น REVIEW แล้วไม่ผ่าน ต้องกลับไป DOING) ' +
      'เมื่อเป็น DONE ระบบบันทึก completedAt ให้ และล้างค่าให้เมื่อถอยออกจาก DONE',
    example: TaskStatus.DOING,
  })
  @IsEnum(TaskStatus, { message: 'สถานะงานต้องเป็น TODO, DOING, WAITING, REVIEW หรือ DONE' })
  status: TaskStatus;
}

export class UpdateTaskOrderDto {
  @ApiProperty({
    description:
      'ตำแหน่งปลายทางในกลุ่มพี่น้องเดียวกัน เริ่มนับที่ 0 ถ้าเกินจำนวนที่มีจะถูกวางท้ายสุด',
    example: 2,
  })
  @IsInt({ message: 'sortOrder ต้องเป็นจำนวนเต็ม' })
  @Min(0, { message: 'sortOrder ต้องไม่ติดลบ' })
  sortOrder: number;
}

export class QueryTasksDto extends PaginationDto {
  @ApiPropertyOptional({ enum: TaskStatus, description: 'กรองตามสถานะ' })
  @IsOptional()
  @IsEnum(TaskStatus, { message: 'สถานะงานต้องเป็น TODO, DOING, WAITING, REVIEW หรือ DONE' })
  status?: TaskStatus;

  @ApiPropertyOptional({ enum: TaskPriority, description: 'กรองตามความสำคัญ' })
  @IsOptional()
  @IsEnum(TaskPriority, { message: 'ความสำคัญต้องเป็น LOW, NORMAL, HIGH หรือ URGENT' })
  priority?: TaskPriority;

  @ApiPropertyOptional({ description: 'กรองเฉพาะงานที่มอบหมายให้พนักงานคนนี้', example: 3 })
  @IsOptional()
  @IsInt({ message: 'assignedUserId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'assignedUserId ต้องมากกว่า 0' })
  assignedUserId?: number;

  @ApiPropertyOptional({
    description:
      'ดูงานย่อยของงานแม่ที่ระบุ — ใช้เจาะดูชั้นที่ 3 ขึ้นไปซึ่งไม่ได้ถูกคืนมากับโครงสร้างซ้อน 2 ระดับ',
    example: 5,
  })
  @IsOptional()
  @IsInt({ message: 'parentTaskId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'parentTaskId ต้องมากกว่า 0' })
  parentTaskId?: number;
}

export class QueryOverdueTasksDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'กรองเฉพาะโครงการนี้', example: 1 })
  @IsOptional()
  @IsInt({ message: 'projectId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'projectId ต้องมากกว่า 0' })
  projectId?: number;

  @ApiPropertyOptional({ description: 'กรองเฉพาะงานที่มอบหมายให้พนักงานคนนี้', example: 3 })
  @IsOptional()
  @IsInt({ message: 'assignedUserId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'assignedUserId ต้องมากกว่า 0' })
  assignedUserId?: number;
}

export const DEFAULT_DUE_SOON_DAYS = 7;
export const MAX_DUE_SOON_DAYS = 90;

export class QueryDueSoonTasksDto extends QueryOverdueTasksDto {
  @ApiPropertyOptional({
    description:
      'ครบกำหนดภายในกี่วันนับจากวันนี้ — 0 = เฉพาะที่ครบกำหนดวันนี้ ' +
      `ไม่ระบุ = ${DEFAULT_DUE_SOON_DAYS} วัน`,
    minimum: 0,
    maximum: MAX_DUE_SOON_DAYS,
    default: DEFAULT_DUE_SOON_DAYS,
    example: DEFAULT_DUE_SOON_DAYS,
  })
  @IsOptional()
  @IsInt({ message: 'withinDays ต้องเป็นจำนวนเต็ม' })
  @Min(0, { message: 'withinDays ต้องไม่ติดลบ' })
  @Max(MAX_DUE_SOON_DAYS, { message: `withinDays ต้องไม่เกิน ${MAX_DUE_SOON_DAYS}` })
  withinDays: number = DEFAULT_DUE_SOON_DAYS;
}

export class QueryCompanyTasksDto extends QueryOverdueTasksDto {
  @ApiPropertyOptional({
    enum: TaskStatus,
    description: 'กรองตามสถานะ เช่น ดูว่าอะไรค้างอยู่ที่ WAITING',
  })
  @IsOptional()
  @IsEnum(TaskStatus, { message: 'สถานะงานต้องเป็น TODO, DOING, WAITING, REVIEW หรือ DONE' })
  status?: TaskStatus;

  @ApiPropertyOptional({ enum: TaskPriority, description: 'กรองตามความสำคัญ' })
  @IsOptional()
  @IsEnum(TaskPriority, { message: 'ความสำคัญต้องเป็น LOW, NORMAL, HIGH หรือ URGENT' })
  priority?: TaskPriority;
}

export class QueryTaskBoardDto {
  @ApiPropertyOptional({ description: 'สรุปเฉพาะโครงการนี้ — ไม่ระบุ = ทั้งบริษัท', example: 1 })
  @IsOptional()
  @IsInt({ message: 'projectId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'projectId ต้องมากกว่า 0' })
  projectId?: number;
}
