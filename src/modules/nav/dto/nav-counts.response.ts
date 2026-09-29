import { ApiProperty } from '@nestjs/swagger';

export class AdminQueueCountsDto {
  @ApiProperty({ example: 2 })
  AWAITING_CLAIM: number;

  @ApiProperty({ example: 1 })
  CLAIMED: number;

  @ApiProperty({ example: 0 })
  AWAITING_REVIEW: number;

  @ApiProperty({ example: 3 })
  WITH_SUPPORT: number;
}

export class SupportQueueCountsDto {
  @ApiProperty({ example: 1 })
  AWAITING_SEND: number;

  @ApiProperty({ example: 0 })
  RETURNED: number;
}

/**
 * ตัวเลข badge ของเมนู — แต่ละช่องเท่ากับ total ของหน้ารายการที่เมนูนั้นเปิด
 * null = ผู้ใช้ไม่มีสิทธิ์เข้าหน้านั้น (ไม่ใช่ 0)
 */
export class NavCountsDto {
  @ApiProperty({
    type: AdminQueueCountsDto,
    nullable: true,
    description: 'GET /tickets/admin-queue แต่ละแท็บ · null ถ้าไม่มี ticket.assign',
  })
  ticketAdminQueue: AdminQueueCountsDto | null;

  @ApiProperty({
    type: SupportQueueCountsDto,
    nullable: true,
    description: 'GET /tickets/support-queue แต่ละแท็บ · null ถ้าไม่มี ticket.support_queue',
  })
  ticketSupportQueue: SupportQueueCountsDto | null;

  @ApiProperty({
    nullable: true,
    example: 2,
    description:
      'ใบที่มอบหมายให้ฉันและยังค้างอยู่กับฉัน (ASSIGNED / IN_PROGRESS / REOPENED) ' +
      '= แท็บ "กำลังทำ" ของหน้าใบของฉัน · null ถ้าไม่มี ticket.view',
  })
  ticketsMineOpen: number | null;

  @ApiProperty({
    nullable: true,
    example: 4,
    description: 'total ของ GET /tasks/reviews?tab=PENDING · null ถ้าไม่มี task.review',
  })
  taskReviewsPending: number | null;

  @ApiProperty({
    nullable: true,
    example: 3,
    description:
      'total ของ GET /tasks/me — งานของฉันที่ยังต้องลงมือ (TODO / DOING / WAITING) ' +
      '= badge เมนู "งานโปรเจกต์" · null ถ้าไม่มี task.view',
  })
  tasksMeOpen: number | null;

  @ApiProperty({
    nullable: true,
    example: 1,
    description:
      'งานของฉัน (DOING / WAITING) ที่รอบส่งล่าสุดถูกตีกลับ — อยู่ใน GET /tasks/me เสมอ · ' +
      'null ถ้าไม่มี task.view',
  })
  tasksMeRejected: number | null;

  @ApiProperty({
    nullable: true,
    example: 2,
    description:
      'total ของ GET /follow-ups?assignedUserId=<ฉัน>&dueByToday=true — งานติดตามของฉันที่เลยกำหนด' +
      'หรือครบกำหนดวันนี้และยังไม่เสร็จ · null ถ้าไม่มี followup.view',
  })
  followUpsMineDue: number | null;

  @ApiProperty({
    nullable: true,
    example: 1,
    description:
      'total ของ GET /warranties/expiring?days=30 — ประกันที่จะหมดภายใน 30 วัน · null ถ้าไม่มี warranty.view',
  })
  warrantiesExpiringSoon: number | null;

  @ApiProperty({
    nullable: true,
    example: 1,
    description:
      'total ของ GET /ma-contracts?expiringInDays=30 — สัญญา MA ที่จะหมดภายใน 30 วัน · null ถ้าไม่มี ma.view',
  })
  maContractsExpiringSoon: number | null;
}
