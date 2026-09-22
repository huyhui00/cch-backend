import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { NotificationEventType, NotificationRule } from '../../../models';
import { Notification, NotificationStatus } from '../../../models/notification.model';

export class NotificationResponseDto {
  @ApiProperty()
  id: number;

  @ApiPropertyOptional({ nullable: true })
  ruleId: number | null;

  @ApiProperty()
  targetUserId: number;

  @ApiProperty({ enum: NotificationEventType })
  eventType: NotificationEventType;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional({ nullable: true })
  message: string | null;

  @ApiPropertyOptional({ nullable: true })
  refType: string | null;

  @ApiPropertyOptional({ nullable: true })
  refId: number | null;

  @ApiProperty({ enum: NotificationStatus })
  status: NotificationStatus;

  @ApiPropertyOptional({ nullable: true })
  scheduledAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  sentAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  readAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  errorMessage: string | null;

  @ApiProperty()
  createdAt: Date;
}

export function toNotificationResponse(row: Notification): NotificationResponseDto {
  return {
    id: row.id,
    ruleId: row.ruleId,
    targetUserId: row.targetUserId,
    eventType: row.eventType,
    title: row.title,
    message: row.message,
    refType: row.refType,
    refId: row.refId,
    status: row.status,
    scheduledAt: row.scheduledAt,
    sentAt: row.sentAt,
    readAt: row.readAt,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
  };
}

export class NotificationRuleResponseDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: NotificationEventType })
  eventType: NotificationEventType;

  @ApiPropertyOptional({ nullable: true })
  daysBefore: number | null;

  @ApiProperty()
  isActive: boolean;

  @ApiPropertyOptional({ nullable: true })
  targetRoleId: number | null;

  @ApiPropertyOptional({ nullable: true })
  targetUserId: number | null;

  @ApiPropertyOptional({ nullable: true })
  messageTemplate: string | null;

  @ApiProperty()
  sendLine: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export function toNotificationRuleResponse(row: NotificationRule): NotificationRuleResponseDto {
  return {
    id: row.id,
    name: row.name,
    eventType: row.eventType,
    daysBefore: row.daysBefore,
    isActive: row.isActive,
    targetRoleId: row.targetRoleId,
    targetUserId: row.targetUserId,
    messageTemplate: row.messageTemplate,
    sendLine: row.sendLine,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DispatchRunResultDto {
  @ApiProperty({ description: 'จำนวนกฎที่รัน' })
  rulesProcessed: number;

  @ApiProperty({ description: 'จำนวนแจ้งเตือนที่สร้างใหม่' })
  created: number;

  @ApiProperty({ description: 'จำนวนที่ส่ง LINE สำเร็จ' })
  lineSent: number;

  @ApiProperty({ description: 'จำนวนที่ส่ง LINE ไม่สำเร็จ' })
  lineFailed: number;

  @ApiProperty({ description: 'จำนวนที่ข้ามเพราะมีแจ้งเตือนซ้ำในวันเดียวกันแล้ว' })
  skippedDuplicate: number;
}
