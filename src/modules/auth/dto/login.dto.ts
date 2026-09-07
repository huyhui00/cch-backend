import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ description: 'ชื่อผู้ใช้', maxLength: 100, example: 'superadmin' })
  @IsString({ message: 'ชื่อผู้ใช้ต้องเป็นข้อความ' })
  @IsNotEmpty({ message: 'กรุณากรอกชื่อผู้ใช้' })
  @MaxLength(100, { message: 'ชื่อผู้ใช้ยาวเกินกำหนด' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  username: string;

  @ApiProperty({ description: 'รหัสผ่าน', example: 'YourStrongPassword123' })
  @IsString({ message: 'รหัสผ่านต้องเป็นข้อความ' })
  @IsNotEmpty({ message: 'กรุณากรอกรหัสผ่าน' })
  @MaxLength(72, { message: 'รหัสผ่านยาวเกินกำหนด' })
  password: string;
}
