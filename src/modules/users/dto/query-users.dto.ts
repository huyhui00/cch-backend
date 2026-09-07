import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsPositive } from 'class-validator';

import { PaginationDto } from '../../../common/dto/pagination.dto';
import { AccountType, UserStatus } from '../../../models';

export class QueryUsersDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: UserStatus,
    description: 'กรองตามสถานะพนักงาน ถ้าไม่ส่งมาจะได้ทุกสถานะรวมคนที่ลาออกแล้ว',
  })
  @IsOptional()
  @IsEnum(UserStatus, { message: 'สถานะต้องเป็น ACTIVE, SUSPENDED หรือ RESIGNED' })
  status?: UserStatus;

  @ApiPropertyOptional({ enum: AccountType, description: 'กรองตามระดับบัญชี' })
  @IsOptional()
  @IsEnum(AccountType, { message: 'ระดับบัญชีต้องเป็น SUPER_ADMIN, ADMIN หรือ USER' })
  accountType?: AccountType;

  @ApiPropertyOptional({ description: 'กรองเฉพาะผู้ใช้ที่ถือ role นี้', example: 3 })
  @IsOptional()
  @IsInt({ message: 'roleId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'roleId ต้องมากกว่า 0' })
  roleId?: number;
}
