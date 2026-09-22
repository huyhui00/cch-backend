import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import { PaginationDto } from '../../../common/dto/pagination.dto';
import { NotificationEventType } from '../../../models';
import { NotificationStatus } from '../../../models/notification.model';

export class QueryNotificationsDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: NotificationStatus,
    description: 'กรองตามสถานะ — ไม่ส่งมา = ทุกสถานะของตัวเอง',
  })
  @IsOptional()
  @IsEnum(NotificationStatus, { message: 'status ไม่ถูกต้อง' })
  status?: NotificationStatus;

  @ApiPropertyOptional({
    description: 'true = ดูของทุกคน (ต้องมี notification.manage) · false/ไม่ส่ง = ดูของตัวเอง',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean({ message: 'all ต้องเป็น boolean' })
  all?: boolean;
}

export class CreateNotificationRuleDto {
  @ApiProperty({ example: 'ประกันใกล้หมดอายุ 30 วัน' })
  @IsString({ message: 'name ต้องเป็นข้อความ' })
  @MaxLength(150, { message: 'name ยาวเกิน 150 ตัวอักษร' })
  name: string;

  @ApiProperty({ enum: NotificationEventType })
  @IsEnum(NotificationEventType, { message: 'eventType ไม่ถูกต้อง' })
  eventType: NotificationEventType;

  @ApiPropertyOptional({
    description: 'แจ้งล่วงหน้ากี่วัน (ใช้กับเหตุการณ์ใกล้หมดอายุ)',
    example: 30,
  })
  @IsOptional()
  @IsInt({ message: 'daysBefore ต้องเป็นจำนวนเต็ม' })
  @Min(0, { message: 'daysBefore ต้องไม่ติดลบ' })
  daysBefore?: number | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean({ message: 'isActive ต้องเป็น boolean' })
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'ส่งให้ทุกคนใน role นี้' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt({ message: 'targetRoleId ต้องเป็นจำนวนเต็ม' })
  @Min(1)
  targetRoleId?: number | null;

  @ApiPropertyOptional({ description: 'หรือเจาะจงพนักงานคนเดียว' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt({ message: 'targetUserId ต้องเป็นจำนวนเต็ม' })
  @Min(1)
  targetUserId?: number | null;

  @ApiPropertyOptional({
    description: 'ข้อความเพิ่ม — ระบบจะต่อท้ายชื่อรายการที่เกี่ยวข้อง',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  messageTemplate?: string | null;

  @ApiPropertyOptional({ default: true, description: 'ส่งผ่าน LINE ด้วยหรือไม่' })
  @IsOptional()
  @IsBoolean()
  sendLine?: boolean;
}

export class UpdateNotificationRuleDto extends PartialType(CreateNotificationRuleDto) {}

export class QueryNotificationRulesDto extends PaginationDto {
  @ApiPropertyOptional({ enum: NotificationEventType })
  @IsOptional()
  @IsEnum(NotificationEventType)
  eventType?: NotificationEventType;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === true || value === 'true' ? true : value === false || value === 'false' ? false : value,
  )
  @IsBoolean()
  isActive?: boolean;
}

export class TestLinePushDto {
  @ApiPropertyOptional({
    description: 'user id ในระบบ CPAMS — ใช้ lineUserId ของคนนั้น · ไม่ส่ง = ใช้ของตัวเอง',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number;

  @ApiPropertyOptional({
    description: 'ข้อความทดสอบ · ไม่ส่ง = ใช้ข้อความเริ่มต้น',
    example: 'ทดสอบแจ้งเตือนจาก CPAMS',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
