import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ description: 'ชื่อบทบาท ห้ามซ้ำ', maxLength: 100, example: 'ฝ่ายซัพพอร์ต' })
  @IsString({ message: 'ชื่อบทบาทต้องเป็นข้อความ' })
  @IsNotEmpty({ message: 'กรุณากรอกชื่อบทบาท' })
  @MaxLength(100, { message: 'ชื่อบทบาทยาวเกิน 100 ตัวอักษร' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  name: string;

  @ApiPropertyOptional({ maxLength: 255, example: 'ดูแลใบแจ้งปัญหาและงานติดตาม' })
  @IsOptional()
  @IsString({ message: 'คำอธิบายต้องเป็นข้อความ' })
  @MaxLength(255, { message: 'คำอธิบายยาวเกิน 255 ตัวอักษร' })
  description?: string;

  @ApiPropertyOptional({ default: true, description: 'ปิดบทบาทไว้ชั่วคราวได้โดยไม่ต้องลบ' })
  @IsOptional()
  @IsBoolean({ message: 'isActive ต้องเป็น true หรือ false' })
  isActive?: boolean;

  @ApiPropertyOptional({
    type: [Number],
    description: 'ติ๊กสิทธิ์ให้เลยตอนสร้างก็ได้ ถ้าไม่ส่งมาจะได้บทบาทที่ยังไม่มีสิทธิ์ใด ๆ',
    example: [1, 2, 5],
  })
  @IsOptional()
  @IsArray({ message: 'permissionIds ต้องเป็น array' })
  @ArrayUnique({ message: 'permissionIds ห้ามมีค่าซ้ำ' })
  @IsInt({ each: true, message: 'permissionIds ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ each: true, message: 'permissionIds ต้องมากกว่า 0' })
  permissionIds?: number[];
}

export class UpdateRoleDto extends PartialType(CreateRoleDto) {}
