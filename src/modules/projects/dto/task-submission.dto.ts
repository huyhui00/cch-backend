import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsPositive,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { PaginationDto } from '../../../common/dto/pagination.dto';
import { TaskStatus, TaskSubmissionStatus } from '../../../models';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateTaskSubmissionDto {
  @ApiProperty({
    description: 'รายงานผลการทำงาน',
    example: 'พัฒนาหน้ารายการสินค้าและทดสอบการค้นหาเรียบร้อย',
  })
  @IsString({ message: 'รายงานผลการทำงานต้องเป็นข้อความ' })
  @IsNotEmpty({ message: 'กรุณากรอกรายงานผลการทำงาน' })
  @MaxLength(10000, { message: 'รายงานผลการทำงานยาวเกิน 10000 ตัวอักษร' })
  @Transform(trim)
  report: string;

  @ApiPropertyOptional({ description: 'ชั่วโมงที่ใช้จริง', example: '6.50' })
  @IsOptional()
  @IsNumberString({ no_symbols: false }, { message: 'ชั่วโมงที่ใช้จริงต้องเป็นตัวเลข' })
  actualHours?: string | null;
}

export class ReviewTaskDto {
  @ApiProperty({ enum: [TaskStatus.DONE, TaskStatus.DOING], example: TaskStatus.DONE })
  @IsEnum([TaskStatus.DONE, TaskStatus.DOING], {
    message: 'ผลตรวจต้องเป็น DONE หรือ DOING เท่านั้น',
  })
  status: TaskStatus.DONE | TaskStatus.DOING;

  @ApiPropertyOptional({ description: 'หมายเหตุจากผู้ตรวจเมื่อส่งกลับแก้ไข' })
  @IsOptional()
  @IsString({ message: 'หมายเหตุต้องเป็นข้อความ' })
  @MaxLength(10000, { message: 'หมายเหตุยาวเกิน 10000 ตัวอักษร' })
  @Transform(trim)
  reviewNote?: string | null;
}

export const TASK_REVIEW_SORT_FIELDS = [
  'projectCode',
  'projectName',
  'taskTitle',
  'submittedAt',
  'reviewedAt',
] as const;
export type TaskReviewSortField = (typeof TASK_REVIEW_SORT_FIELDS)[number];

export enum TaskReviewTab {
  PENDING = 'PENDING',
  REVIEWED = 'REVIEWED',
}

/** เมนู "งานตรวจ" — แท็บรอตรวจ / ที่ฉันตรวจไปแล้ว */
export class QueryTaskReviewsDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: TaskReviewTab,
    default: TaskReviewTab.PENDING,
    description: 'PENDING = รายงานที่รอตรวจและฉันมีสิทธิ์ตรวจ · REVIEWED = รายงานที่ฉันตรวจไปแล้ว',
  })
  @IsOptional()
  @IsEnum(TaskReviewTab, { message: 'tab ต้องเป็น PENDING หรือ REVIEWED' })
  tab: TaskReviewTab = TaskReviewTab.PENDING;

  @ApiPropertyOptional({
    enum: [TaskSubmissionStatus.APPROVED, TaskSubmissionStatus.REJECTED],
    description: 'ใช้กับแท็บ REVIEWED — กรองผลตรวจ (ผ่าน / ส่งกลับแก้)',
  })
  @IsOptional()
  @IsEnum([TaskSubmissionStatus.APPROVED, TaskSubmissionStatus.REJECTED], {
    message: 'result ต้องเป็น APPROVED หรือ REJECTED',
  })
  result?: TaskSubmissionStatus.APPROVED | TaskSubmissionStatus.REJECTED;

  @ApiPropertyOptional({ description: 'กรองเฉพาะโครงการนี้', example: 1 })
  @IsOptional()
  @IsInt({ message: 'projectId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'projectId ต้องมากกว่า 0' })
  projectId?: number;

  @ApiPropertyOptional({
    enum: TASK_REVIEW_SORT_FIELDS,
    description:
      'ไม่ส่ง = ลำดับเริ่มต้นของแท็บ · ใช้คู่กับ sortOrder (ASC/DESC) · ' +
      'projectCode: แถวที่ไม่มีรหัสอยู่ท้ายเสมอ',
  })
  @IsOptional()
  @IsIn(TASK_REVIEW_SORT_FIELDS, {
    message: `sortBy ต้องเป็น ${TASK_REVIEW_SORT_FIELDS.join(', ')}`,
  })
  sortBy?: TaskReviewSortField;
}
