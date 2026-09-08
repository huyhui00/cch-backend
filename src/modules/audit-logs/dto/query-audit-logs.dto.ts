import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

import { PaginationDto } from '../../../common/dto/pagination.dto';
import { AuditAction } from '../../../models';

export class QueryAuditLogsDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'กรองเฉพาะ action ที่ผู้ใช้คนนี้เป็นผู้กระทำ',
    example: 1,
  })
  @IsOptional()
  @IsInt({ message: 'userId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'userId ต้องมากกว่า 0' })
  userId?: number;

  @ApiPropertyOptional({
    description: 'ชื่อตารางในฐานข้อมูล (snake_case)',
    example: 'users',
    maxLength: 100,
  })
  @IsOptional()
  @IsString({ message: 'tableName ต้องเป็นข้อความ' })
  @MaxLength(100, { message: 'tableName ยาวเกินกำหนด' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  tableName?: string;

  @ApiPropertyOptional({
    description: 'id ของแถวที่ถูกกระทำ ใช้คู่กับ tableName เพื่อดูประวัติของข้อมูลชิ้นเดียว',
    example: 5,
  })
  @IsOptional()
  @IsInt({ message: 'recordId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'recordId ต้องมากกว่า 0' })
  recordId?: number;

  @ApiPropertyOptional({ enum: AuditAction, description: 'ชนิดของ action' })
  @IsOptional()
  @IsEnum(AuditAction, {
    message: 'action ต้องเป็น CREATE, UPDATE, DELETE, BULK_CREATE, BULK_UPDATE หรือ BULK_DELETE',
  })
  action?: AuditAction;

  @ApiPropertyOptional({
    description: 'ตั้งแต่วันที่ (รวมวันนั้นด้วย) รูปแบบ ISO 8601',
    example: '2026-09-01',
  })
  @IsOptional()
  @IsISO8601({}, { message: 'dateFrom ต้องเป็นวันที่รูปแบบ ISO 8601 เช่น 2026-09-01' })
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'ถึงวันที่ (รวมวันนั้นด้วย) รูปแบบ ISO 8601',
    example: '2026-09-30',
  })
  @IsOptional()
  @IsISO8601({}, { message: 'dateTo ต้องเป็นวันที่รูปแบบ ISO 8601 เช่น 2026-09-30' })
  dateTo?: string;
}
