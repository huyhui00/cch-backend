import { ApiProperty } from '@nestjs/swagger';

import { AuditAction, AuditLog } from '../../../models';

/** ผู้กระทำ — เก็บชื่อไว้แสดงบนหน้าจอโดยไม่ต้องยิงถามตาราง users ซ้ำ */
export class AuditActorDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'somchai' })
  username: string;

  @ApiProperty({ example: 'สมชาย ใจดี' })
  fullName: string;
}

export class AuditLogResponseDto {
  @ApiProperty({ example: 128 })
  id: number;

  @ApiProperty({ enum: AuditAction, example: AuditAction.UPDATE })
  action: string;

  @ApiProperty({ example: 'users', description: 'ชื่อตารางในฐานข้อมูล' })
  tableName: string;

  @ApiProperty({
    nullable: true,
    example: 5,
    description: 'null ในกรณีตารางเชื่อมที่ใช้ composite key หรือคำสั่งแบบหลายแถว',
  })
  recordId: number | null;

  @ApiProperty({
    nullable: true,
    example: 1,
    description: 'null เมื่อระบบเป็นผู้กระทำเอง เช่น scheduler',
  })
  userId: number | null;

  @ApiProperty({
    type: AuditActorDto,
    nullable: true,
    description: 'ยังคืนค่าได้แม้ผู้ใช้คนนั้นถูก soft delete ไปแล้ว (BR-09)',
  })
  user: AuditActorDto | null;

  @ApiProperty({
    nullable: true,
    description: 'ค่าก่อนแก้ไข — กรณี UPDATE จะมีเฉพาะฟิลด์ที่เปลี่ยนจริง',
    example: { status: 'ACTIVE' },
  })
  oldValue: unknown;

  @ApiProperty({
    nullable: true,
    description: 'ค่าหลังแก้ไข',
    example: { status: 'SUSPENDED' },
  })
  newValue: unknown;

  @ApiProperty({ nullable: true, example: '127.0.0.1' })
  ipAddress: string | null;

  @ApiProperty({ nullable: true, example: 'Mozilla/5.0 ...' })
  userAgent: string | null;

  @ApiProperty({ example: '2026-09-08T03:12:44.000Z' })
  createdAt: Date;
}

export function toAuditLogResponse(log: AuditLog): AuditLogResponseDto {
  return {
    id: log.id,
    action: log.action,
    tableName: log.tableName,
    recordId: log.recordId,
    userId: log.userId,
    user: log.user
      ? { id: log.user.id, username: log.user.username, fullName: log.user.fullName }
      : null,
    oldValue: log.oldValue ?? null,
    newValue: log.newValue ?? null,
    ipAddress: log.ipAddress,
    userAgent: log.userAgent,
    createdAt: log.createdAt,
  };
}
