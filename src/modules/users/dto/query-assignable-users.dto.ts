import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

export enum AssignableCapability {
  TASK = 'TASK',
  TICKET = 'TICKET',
  TASK_REVIEW = 'TASK_REVIEW',
}

export class QueryAssignableUsersDto {
  @ApiPropertyOptional({
    enum: AssignableCapability,
    description: 'กรองผู้รับตามความสามารถของงานที่จะมอบหมาย',
    example: AssignableCapability.TASK,
  })
  @IsOptional()
  @IsEnum(AssignableCapability, { message: 'ประเภทความสามารถไม่ถูกต้อง' })
  capability?: AssignableCapability;
}
