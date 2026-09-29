import { ApiProperty } from '@nestjs/swagger';

import { todayAsDateOnly } from '../../../common/utils/date.util';
import {
  Project,
  ProjectPriority,
  ProjectStatus,
  Task,
  TaskPriority,
  TaskSubmission,
  TaskSubmissionStatus,
  TaskStatus,
} from '../../../models';

/** ผู้ใช้แบบย่อ — แสดงชื่อผู้จัดการหรือผู้รับผิดชอบงานโดยไม่ต้องยิงถามตาราง users ซ้ำ */
export class UserSummaryDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'somchai' })
  username: string;

  @ApiProperty({ example: 'สมชาย ใจดี' })
  fullName: string;
}

export class CustomerSummaryDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'บริษัท ตัวอย่าง จำกัด' })
  name: string;
}

export class TaskResponseDto {
  @ApiProperty({ example: 5 })
  id: number;

  @ApiProperty({ example: 1 })
  projectId: number;

  @ApiProperty({ nullable: true, example: null })
  parentTaskId: number | null;

  @ApiProperty({ example: 'ออกแบบหน้าจอรับสินค้าเข้าคลัง' })
  title: string;

  @ApiProperty({ nullable: true })
  description: string | null;

  @ApiProperty({ enum: TaskStatus })
  status: TaskStatus;

  @ApiProperty({ enum: TaskPriority })
  priority: TaskPriority;

  @ApiProperty({ nullable: true, example: 3 })
  assignedUserId: number | null;

  @ApiProperty({ nullable: true, example: 2, description: 'ผู้มอบหมายงาน' })
  assignedByUserId: number | null;

  @ApiProperty({ type: UserSummaryDto, nullable: true })
  assignedUser: UserSummaryDto | null;

  @ApiProperty({ type: UserSummaryDto, nullable: true })
  assignedByUser: UserSummaryDto | null;

  @ApiProperty({ nullable: true, example: '2026-09-10' })
  startDate: string | null;

  @ApiProperty({ nullable: true, example: '2026-09-20' })
  dueDate: string | null;

  @ApiProperty({ nullable: true, description: 'ระบบบันทึกให้เองเมื่อเปลี่ยนสถานะเป็น DONE' })
  completedAt: Date | null;

  @ApiProperty({ nullable: true, example: '16.00' })
  estimatedHours: string | null;

  @ApiProperty({ nullable: true, example: '18.50' })
  actualHours: string | null;

  @ApiProperty({ type: () => [TaskSubmissionResponseDto] })
  submissions: TaskSubmissionResponseDto[];

  @ApiProperty({ description: 'ลำดับการแสดงผลในกลุ่มพี่น้องเดียวกัน', example: 0 })
  sortOrder: number;

  @ApiProperty({
    description: 'เกินกำหนดแล้วหรือยัง — dueDate ผ่านไปแล้วและสถานะยังไม่ใช่ DONE',
    example: false,
  })
  isOverdue: boolean;

  @ApiProperty({
    type: [TaskResponseDto],
    description:
      'งานย่อยหนึ่งชั้น จะมีค่าเฉพาะ endpoint ที่คืนโครงสร้างซ้อน ' +
      'ชั้นที่ 3 ขึ้นไปดูได้โดยกรองด้วย parentTaskId',
  })
  subTasks: TaskResponseDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class TaskSubmissionResponseDto {
  @ApiProperty({ example: 10 })
  id: number;

  @ApiProperty({ example: 5 })
  taskId: number;

  @ApiProperty({ example: 3 })
  submittedByUserId: number;

  @ApiProperty()
  report: string;

  @ApiProperty({ nullable: true, example: '6.50' })
  actualHours: string | null;

  @ApiProperty({ enum: TaskSubmissionStatus })
  status: TaskSubmissionStatus;

  @ApiProperty({ nullable: true })
  reviewNote: string | null;

  @ApiProperty({ nullable: true })
  reviewedAt: Date | null;

  @ApiProperty({ nullable: true, description: 'ไฟล์รายงานที่ดาวน์โหลดผ่าน API' })
  fileName: string | null;

  @ApiProperty({ nullable: true })
  downloadUrl: string | null;

  @ApiProperty({ nullable: true, example: 4 })
  reviewedByUserId: number | null;

  @ApiProperty({ nullable: true, description: 'ไฟล์ที่ผู้ตรวจแนบตอนส่งกลับแก้' })
  reviewFileName: string | null;

  @ApiProperty({ nullable: true })
  reviewDownloadUrl: string | null;

  @ApiProperty()
  submittedAt: Date;
}

export class TaskProjectSummaryDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ nullable: true, example: 'PRJ69-0001' })
  code: string | null;

  @ApiProperty({ example: 'ระบบจัดการคลังสินค้า' })
  name: string;

  @ApiProperty({
    enum: ProjectStatus,
    description: 'สถานะของโครงการ — ให้หน้าจอแยกงานที่ค้างอยู่ในโครงการที่ปิดหรือยกเลิกไปแล้วได้',
  })
  status: ProjectStatus;
}

/**
 * งานในรายการรวมทั้งบริษัท (M2-07) — เหมือน TaskResponseDto ทุกฟิลด์ เพิ่มโครงการที่งานสังกัด
 * เพราะหน้าจอรวมแสดงงานหลายโครงการปนกัน ถ้าไม่มีชื่อโครงการจะแยกไม่ออกว่างานไหนของใคร
 * แยกเป็นคลาสใหม่ ไม่ได้เพิ่มฟิลด์ลงใน TaskResponseDto เพื่อไม่เปลี่ยนสัญญาของ endpoint เดิม
 */
export class CompanyTaskResponseDto extends TaskResponseDto {
  @ApiProperty({ type: TaskProjectSummaryDto, nullable: true })
  project: TaskProjectSummaryDto | null;
}

/** GET /projects/options — ตัวเลือกดรอปดาวน์ ห้ามเติมฟิลด์ให้กลายเป็นรายการโครงการเต็ม */
export class ProjectOptionDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ nullable: true, example: 'PRJ69-0001' })
  code: string | null;

  @ApiProperty({ example: 'ระบบจัดการคลังสินค้า' })
  name: string;

  @ApiProperty({ enum: ProjectStatus, example: ProjectStatus.IN_PROGRESS })
  status: ProjectStatus;
}

export class TaskReviewTaskSummaryDto {
  @ApiProperty({ example: 5 })
  id: number;

  @ApiProperty({ example: 'หน้ารายการสินค้า' })
  title: string;

  @ApiProperty({ enum: TaskStatus })
  status: TaskStatus;

  @ApiProperty({ enum: TaskPriority })
  priority: TaskPriority;

  @ApiProperty({ nullable: true, example: '2026-10-01' })
  dueDate: string | null;
}

/** แถวในเมนู "งานตรวจ" — หนึ่งแถวต่อรายงานการส่งตรวจหนึ่งรอบ */
export class TaskReviewItemDto {
  @ApiProperty({ type: TaskSubmissionResponseDto })
  submission: TaskSubmissionResponseDto;

  @ApiProperty({ type: TaskReviewTaskSummaryDto })
  task: TaskReviewTaskSummaryDto;

  @ApiProperty({ type: TaskProjectSummaryDto, nullable: true })
  project: TaskProjectSummaryDto | null;

  @ApiProperty({ type: UserSummaryDto, nullable: true })
  submittedBy: UserSummaryDto | null;

  @ApiProperty({ type: UserSummaryDto, nullable: true })
  reviewedBy: UserSummaryDto | null;
}

export class TaskAssigneeLoadDto {
  @ApiProperty({ nullable: true, description: 'null = งานที่ยังไม่มีผู้รับผิดชอบ', example: 3 })
  assignedUserId: number | null;

  @ApiProperty({ nullable: true, example: 'สมชาย ใจดี' })
  fullName: string | null;

  @ApiProperty({ description: 'จำนวนงานที่ยังไม่เสร็จ (ไม่นับ DONE)', example: 6 })
  openTasks: number;

  @ApiProperty({ description: 'จำนวนงานที่เกินกำหนดในงานที่ยังไม่เสร็จ', example: 2 })
  overdueTasks: number;

  @ApiProperty({
    description: 'งานที่ยังไม่เสร็จแยกตามสถานะ',
    example: { TODO: 2, DOING: 2, WAITING: 1, REVIEW: 1 },
  })
  byStatus: Record<string, number>;
}

/**
 * M2-07 ภาพรวมงานทั้งบริษัท — ดูว่างานติดขัดอยู่ที่ขั้นตอนไหนและอยู่กับใคร
 *
 * นับงานทุกชั้นแบบแบน (งานย่อยนับเป็นหนึ่งงาน) กติกาเดียวกับความคืบหน้าโครงการ
 * สถานะที่ไม่มีงานเลยคืนมาเป็น 0 เสมอ หน้าจอจะวาดคอลัมน์ได้ครบทุกสถานะโดยไม่ต้องเติมเอง
 */
export class TaskBoardSummaryDto {
  @ApiProperty({ description: 'จำนวนงานทั้งหมด', example: 40 })
  totalTasks: number;

  @ApiProperty({ description: 'จำนวนงานที่ยังไม่เสร็จ', example: 28 })
  openTasks: number;

  @ApiProperty({ description: 'จำนวนงานที่เกินกำหนดและยังไม่เสร็จ', example: 5 })
  overdueTasks: number;

  @ApiProperty({
    description: 'จำนวนงานแยกตามสถานะ ครบทุกสถานะ',
    example: { TODO: 10, DOING: 8, WAITING: 6, REVIEW: 4, DONE: 12 },
  })
  byStatus: Record<string, number>;

  @ApiProperty({
    description:
      'งานที่เกินกำหนดแยกตามสถานะ — บอกว่างานที่ช้าติดอยู่ที่ขั้นไหน (DONE ไม่มีวันเกินกำหนด)',
    example: { TODO: 1, DOING: 1, WAITING: 3, REVIEW: 0 },
  })
  overdueByStatus: Record<string, number>;

  @ApiProperty({
    type: [TaskAssigneeLoadDto],
    description: 'ภาระงานที่ยังไม่เสร็จของแต่ละคน เรียงคนที่มีงานเกินกำหนดมากที่สุดขึ้นก่อน',
  })
  byAssignee: TaskAssigneeLoadDto[];
}

/** สรุปความคืบหน้าของโครงการ — นับ task ทุกชั้นแบบแบน ไม่แยกงานแม่งานย่อย */
export class ProjectProgressDto {
  @ApiProperty({ description: 'จำนวนงานทั้งหมดในโครงการ (นับรวมงานย่อยทุกชั้น)', example: 12 })
  totalTasks: number;

  @ApiProperty({ description: 'จำนวนงานที่สถานะเป็น DONE', example: 9 })
  doneTasks: number;

  @ApiProperty({
    description:
      'เปอร์เซ็นต์ความคืบหน้า = (งานที่ DONE / งานทั้งหมด) x 100 ปัดทศนิยม 2 ตำแหน่ง — เป็น 0 เมื่อยังไม่มีงานเลย',
    example: 75,
  })
  percent: number;

  @ApiProperty({ description: 'จำนวนงานที่เกินกำหนดและยังไม่เสร็จ', example: 2 })
  overdueTasks: number;

  @ApiProperty({
    description: 'จำนวนงานแยกตามสถานะ ใช้วาดแถบสรุปบนหน้าจอ',
    example: { TODO: 2, DOING: 1, WAITING: 0, REVIEW: 0, DONE: 9 },
  })
  byStatus: Record<string, number>;
}

/**
 * B-6 — สรุปตัวเลขบนหน้ารายละเอียดโปรเจค (ประชุมครั้งที่ 3)
 *
 * FE เคยประกอบจากข้อมูลในหน้าเองชั่วคราว เพราะยังไม่มีเส้นนี้
 * นับแถวที่ยังไม่ soft delete ตาม project_id — ไม่กรองสถานะย่อย
 * (CANCELLED / CLOSED ยังถูกนับ เพราะยังอยู่ในประวัติของโปรเจค)
 */
export class ProjectReportDto {
  @ApiProperty({ example: 1 })
  projectId: number;

  @ApiProperty({ type: ProjectProgressDto })
  progress: ProjectProgressDto;

  @ApiProperty({ description: 'จำนวนใบแจ้งปัญหาของโปรเจคนี้', example: 3 })
  ticketCount: number;

  @ApiProperty({ description: 'จำนวนใบส่งมอบของโปรเจคนี้', example: 2 })
  deliveryCount: number;

  @ApiProperty({ description: 'จำนวนสัญญา MA ของโปรเจคนี้', example: 1 })
  maContractCount: number;
}

export class ProjectResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 1 })
  customerId: number;

  @ApiProperty({ type: CustomerSummaryDto, nullable: true })
  customer: CustomerSummaryDto | null;

  @ApiProperty({ nullable: true, example: 'PRJ69-0001' })
  code: string | null;

  @ApiProperty({ example: 'ระบบจัดการคลังสินค้า' })
  name: string;

  @ApiProperty({ nullable: true })
  description: string | null;

  @ApiProperty({ nullable: true, example: 'SOFTWARE' })
  projectType: string | null;

  @ApiProperty({ enum: ProjectStatus })
  status: ProjectStatus;

  @ApiProperty({ enum: ProjectPriority })
  priority: ProjectPriority;

  @ApiProperty({ nullable: true, example: '2026-09-01' })
  startDate: string | null;

  @ApiProperty({ nullable: true, example: '2026-12-31' })
  targetEndDate: string | null;

  @ApiProperty({ nullable: true })
  actualEndDate: string | null;

  @ApiProperty({ nullable: true, example: '1500000.00' })
  contractValue: string | null;

  @ApiProperty({
    nullable: true,
    example: 42,
    description: 'ใช้เป็นตัวตั้งคิดราคา MA ภายหลัง คู่กับมูลค่าสัญญา (BR-05)',
  })
  functionCount: number | null;

  @ApiProperty({ nullable: true, example: 3 })
  managerUserId: number | null;

  @ApiProperty({ type: UserSummaryDto, nullable: true })
  manager: UserSummaryDto | null;

  @ApiProperty({
    type: ProjectProgressDto,
    nullable: true,
    description:
      'มีค่าทั้งรายการโครงการและรายละเอียด (สูตรเดียวกัน) — หน้ารายการไม่ต้องยิงรายละเอียดทีละโครงการ',
  })
  progress: ProjectProgressDto | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

function toUserSummary(
  user: { id: number; username: string; fullName: string } | null | undefined,
): UserSummaryDto | null {
  return user ? { id: user.id, username: user.username, fullName: user.fullName } : null;
}

/**
 * เกินกำหนด = มีวันครบกำหนด และวันนั้นผ่านไปแล้ว และงานยังไม่ DONE
 * เทียบเป็นวัน ไม่ใช่เวลา เพราะ due_date เก็บเป็น DATEONLY — งานที่ครบกำหนดวันนี้
 * ยังไม่ถือว่าเกิน จนกว่าจะข้ามไปวันถัดไป
 */
export function isTaskOverdue(task: Pick<Task, 'dueDate' | 'status'>): boolean {
  if (!task.dueDate || task.status === TaskStatus.DONE) {
    return false;
  }

  return task.dueDate < todayAsDateOnly();
}

// นิยามจริงอยู่ที่ common/utils/date.util.ts — ปล่อยผ่านต่อไว้ตรงนี้เพื่อไม่ให้
// ผู้เรียกเดิมต้องแก้ import และไม่ให้มีสูตรวันที่สองชุดในระบบ
export { todayAsDateOnly };

export function toTaskResponse(task: Task, includeSubTasks = true): TaskResponseDto {
  return {
    id: task.id,
    projectId: task.projectId,
    parentTaskId: task.parentTaskId,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    assignedUserId: task.assignedUserId,
    assignedByUserId: task.assignedByUserId,
    assignedUser: toUserSummary(task.assignedUser),
    assignedByUser: toUserSummary(task.assignedByUser),
    startDate: task.startDate,
    dueDate: task.dueDate,
    completedAt: task.completedAt,
    estimatedHours: task.estimatedHours,
    actualHours: task.actualHours,
    submissions: (task.submissions ?? []).map(toTaskSubmissionResponse),
    sortOrder: task.sortOrder,
    isOverdue: isTaskOverdue(task),
    // ตัดที่ชั้นเดียว — งานย่อยของงานย่อยไม่ถูกคืนมาโดยอัตโนมัติ
    subTasks:
      includeSubTasks && task.subTasks
        ? task.subTasks.map((sub) => toTaskResponse(sub, false))
        : [],
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export function toTaskSubmissionResponse(submission: TaskSubmission): TaskSubmissionResponseDto {
  return {
    id: submission.id,
    taskId: submission.taskId,
    submittedByUserId: submission.submittedByUserId,
    report: submission.report,
    actualHours: submission.actualHours,
    status: submission.status,
    reviewNote: submission.reviewNote,
    reviewedAt: submission.reviewedAt,
    fileName: submission.fileName,
    downloadUrl: submission.fileUrl ? `/api/tasks/submissions/${submission.id}/download` : null,
    reviewedByUserId: submission.reviewedByUserId,
    reviewFileName: submission.reviewFileName,
    reviewDownloadUrl: submission.reviewFileUrl
      ? `/api/tasks/submissions/${submission.id}/review-file/download`
      : null,
    submittedAt: submission.createdAt,
  };
}

export function toTaskReviewItem(submission: TaskSubmission): TaskReviewItemDto {
  const task = submission.task;
  return {
    submission: toTaskSubmissionResponse(submission),
    task: {
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate,
    },
    project: task.project
      ? {
          id: task.project.id,
          code: task.project.code,
          name: task.project.name,
          status: task.project.status,
        }
      : null,
    submittedBy: toUserSummary(submission.submittedBy),
    reviewedBy: toUserSummary(submission.reviewedBy),
  };
}

export function toCompanyTaskResponse(task: Task): CompanyTaskResponseDto {
  return {
    ...toTaskResponse(task, false),
    project: task.project
      ? {
          id: task.project.id,
          code: task.project.code,
          name: task.project.name,
          status: task.project.status,
        }
      : null,
  };
}

export function toProjectResponse(
  project: Project,
  progress: ProjectProgressDto | null = null,
): ProjectResponseDto {
  return {
    id: project.id,
    customerId: project.customerId,
    customer: project.customer ? { id: project.customer.id, name: project.customer.name } : null,
    code: project.code,
    name: project.name,
    description: project.description,
    projectType: project.projectType,
    status: project.status,
    priority: project.priority,
    startDate: project.startDate,
    targetEndDate: project.targetEndDate,
    actualEndDate: project.actualEndDate,
    contractValue: project.contractValue,
    functionCount: project.functionCount,
    managerUserId: project.managerUserId,
    manager: toUserSummary(project.manager),
    progress,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}
