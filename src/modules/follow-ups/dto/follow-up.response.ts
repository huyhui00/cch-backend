import { ApiProperty } from '@nestjs/swagger';

import { daysUntil, todayAsDateOnly } from '../../../common/utils/date.util';
import { FollowUp, FollowUpStatus } from '../../../models';

/** สถานะที่ถือว่างานยัง "ค้างอยู่" — ใช้ทั้งตอนคิด isOverdue และตอนกรอง ?overdue= */
export const OPEN_FOLLOW_UP_STATUSES: readonly FollowUpStatus[] = [
  FollowUpStatus.PLANNED,
  FollowUpStatus.OVERDUE,
];

export class FollowUpCustomerSummaryDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'บริษัท ตัวอย่าง จำกัด' })
  name: string;

  @ApiProperty({ nullable: true, example: 'CUS-0001' })
  code: string | null;
}

export class FollowUpProjectSummaryDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ nullable: true, example: 'PRJ-2026-003' })
  code: string | null;

  @ApiProperty({ example: 'ระบบจัดการคลังสินค้า' })
  name: string;
}

export class FollowUpUserSummaryDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ example: 'somchai' })
  username: string;

  @ApiProperty({ example: 'สมชาย ใจดี' })
  fullName: string;
}

export class FollowUpResponseDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 1 })
  customerId: number;

  @ApiProperty({ nullable: true, type: FollowUpCustomerSummaryDto })
  customer: FollowUpCustomerSummaryDto | null;

  @ApiProperty({
    nullable: true,
    description: 'โปรเจคที่ติดตาม — งานที่สร้างก่อน 11 ก.ย. เป็น null',
    example: 3,
  })
  projectId: number | null;

  @ApiProperty({ nullable: true, type: FollowUpProjectSummaryDto })
  project: FollowUpProjectSummaryDto | null;

  @ApiProperty({ example: 'โทรถามความคืบหน้าการตัดสินใจต่อสัญญา MA' })
  title: string;

  @ApiProperty({ nullable: true, description: 'รายละเอียดตอนวางแผน' })
  detail: string | null;

  @ApiProperty({ example: '2026-09-20' })
  dueDate: string;

  @ApiProperty({ enum: FollowUpStatus, description: 'สถานะที่บันทึกไว้ในฐานข้อมูล' })
  status: FollowUpStatus;

  @ApiProperty({
    description:
      '**หน้าจอต้องอ่านค่านี้ ไม่ใช่ `status === OVERDUE`** — คิดจาก `dueDate < วันนี้` ' +
      'คู่กับสถานะที่ยังค้าง เพราะยังไม่มี scheduler ปรับ status เป็น OVERDUE ให้ ' +
      'จนกว่าจะถึง Phase 11 แถวที่เลยกำหนดแล้วจึงยังค้างเป็น PLANNED อยู่ในฐานข้อมูล',
    example: false,
  })
  isOverdue: boolean;

  @ApiProperty({
    description: 'เหลืออีกกี่วันถึงกำหนด ติดลบแปลว่าเลยกำหนดมากี่วันแล้ว',
    example: 10,
  })
  daysUntilDue: number;

  @ApiProperty({ nullable: true, example: 4 })
  assignedUserId: number | null;

  @ApiProperty({ nullable: true, type: FollowUpUserSummaryDto })
  assignedUser: FollowUpUserSummaryDto | null;

  @ApiProperty({
    nullable: true,
    description: 'เวลาที่ปิดงาน — ระบบใส่ให้เองตอนสถานะเป็น DONE ไม่ได้รับจาก client',
  })
  completedAt: Date | null;

  @ApiProperty({ nullable: true, description: 'ผลของการติดตาม บันทึกตอนทำเสร็จ' })
  resultNote: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

/**
 * งานติดตามเลยกำหนดหรือยัง
 *
 * เหตุผลเดียวกับ `isCurrentlyActive` ของประกัน (Phase 6) และสัญญา MA (Phase 8) —
 * คอลัมน์ `status` เชื่อไม่ได้เพราะไม่มีใครไปปรับให้เป็น OVERDUE จนกว่าจะมี scheduler
 * เงื่อนไขตรงนี้ต้องตรงกับที่ `FollowUpsService` ใช้ query จริงตอนกรอง `?overdue=true`
 *
 * งานที่ครบกำหนด "วันนี้" ยังไม่นับว่าเลยกำหนด — กติกาเดียวกับงานย่อยใน Phase 5
 */
export function isFollowUpOverdue(followUp: FollowUp, today = todayAsDateOnly()): boolean {
  return OPEN_FOLLOW_UP_STATUSES.includes(followUp.status) && followUp.dueDate < today;
}

export function toFollowUpResponse(followUp: FollowUp): FollowUpResponseDto {
  return {
    id: followUp.id,
    customerId: followUp.customerId,
    customer: followUp.customer
      ? {
          id: followUp.customer.id,
          name: followUp.customer.name,
          code: followUp.customer.code,
        }
      : null,
    projectId: followUp.projectId ?? null,
    project: followUp.project
      ? { id: followUp.project.id, code: followUp.project.code, name: followUp.project.name }
      : null,
    title: followUp.title,
    detail: followUp.detail,
    dueDate: followUp.dueDate,
    status: followUp.status,
    isOverdue: isFollowUpOverdue(followUp),
    daysUntilDue: daysUntil(followUp.dueDate),
    assignedUserId: followUp.assignedUserId,
    assignedUser: followUp.assignedUser
      ? {
          id: followUp.assignedUser.id,
          username: followUp.assignedUser.username,
          fullName: followUp.assignedUser.fullName,
        }
      : null,
    completedAt: followUp.completedAt,
    resultNote: followUp.resultNote,
    createdAt: followUp.createdAt,
    updatedAt: followUp.updatedAt,
  };
}
