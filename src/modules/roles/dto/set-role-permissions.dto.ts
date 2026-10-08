import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsInt, IsPositive } from 'class-validator';

export class SetRolePermissionsDto {
  @ApiProperty({
    type: [Number],
    description: 'id ของสิทธิ์ที่ติ๊กไว้ทั้งหมดในหน้าจอ (ค่าที่ส่งมาคือผลลัพธ์สุดท้าย)',
    example: [1, 2, 5, 8],
  })
  @IsArray({ message: 'permissionIds ต้องเป็น array' })
  @ArrayUnique({ message: 'permissionIds ห้ามมีค่าซ้ำ' })
  @IsInt({ each: true, message: 'permissionIds ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ each: true, message: 'permissionIds ต้องมากกว่า 0' })
  permissionIds: number[];
}
