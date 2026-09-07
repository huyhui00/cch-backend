import { ApiProperty } from '@nestjs/swagger';
import { IsJWT, IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'refresh token ที่ได้จากตอน login หรือจากการ refresh ครั้งก่อน',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString({ message: 'refreshToken ต้องเป็นข้อความ' })
  @IsNotEmpty({ message: 'กรุณาส่ง refreshToken' })
  @IsJWT({ message: 'รูปแบบ refreshToken ไม่ถูกต้อง' })
  refreshToken: string;
}
