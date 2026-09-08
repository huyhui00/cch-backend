import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

import { PaginationDto } from '../../../common/dto/pagination.dto';
import { CustomerStatus } from '../../../models';

export class QueryCustomersDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: CustomerStatus,
    description: 'กรองตามสถานะ ถ้าไม่ส่งมาจะได้ทุกสถานะ',
  })
  @IsOptional()
  @IsEnum(CustomerStatus, {
    message: 'สถานะลูกค้าต้องเป็น PROSPECT, ACTIVE, INACTIVE หรือ CHURNED',
  })
  status?: CustomerStatus;

  @ApiPropertyOptional({ description: 'กรองเฉพาะลูกค้าที่พนักงานคนนี้ดูแล', example: 3 })
  @IsOptional()
  @IsInt({ message: 'ownerUserId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'ownerUserId ต้องมากกว่า 0' })
  ownerUserId?: number;

  @ApiPropertyOptional({ description: 'กรองตามประเภทธุรกิจ', maxLength: 150 })
  @IsOptional()
  @IsString({ message: 'businessType ต้องเป็นข้อความ' })
  @MaxLength(150, { message: 'businessType ยาวเกินกำหนด' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  businessType?: string;

  @ApiPropertyOptional({ description: 'กรองตามจังหวัด', maxLength: 100, example: 'ชลบุรี' })
  @IsOptional()
  @IsString({ message: 'province ต้องเป็นข้อความ' })
  @MaxLength(100, { message: 'province ยาวเกินกำหนด' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  province?: string;

  @ApiPropertyOptional({
    description:
      'กรองเฉพาะลูกค้าที่ไม่ได้ติดต่อมานานเกินกี่วัน — ใช้กับหน้าจอ "ลูกค้าที่ถูกลืม" ' +
      'ลูกค้าที่ยังไม่เคยติดต่อเลย (lastContactedAt ว่าง) จะถูกนับรวมด้วยเสมอ',
    example: 60,
  })
  @IsOptional()
  @IsInt({ message: 'idleDays ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'idleDays ต้องมากกว่า 0' })
  idleDays?: number;
}
