import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { TaskStatus } from '../../../models';

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
