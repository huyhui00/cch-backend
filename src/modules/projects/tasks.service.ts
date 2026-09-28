import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, type Order, type Transaction, type WhereOptions } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { getCurrentUserId } from '../../common/context/request-context';
import {
  PaginationDto,
  type PaginatedResult,
  type SortOrder,
  toPaginatedResult,
} from '../../common/dto/pagination.dto';
import { addDays } from '../../common/utils/date.util';
import { AccessControlService } from '../../common/services/access-control.service';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import {
  AccountType,
  Document,
  DocumentType,
  Project,
  Task,
  TaskStatus,
  TaskSubmission,
  TaskSubmissionStatus,
  User,
  UserStatus,
} from '../../models';
import { StorageService, type StoredFileStream } from '../files/storage.service';
import { assertUploadable, buildStorageKey, type UploadedFileLike } from '../files/upload.util';
import { ProjectsService } from './projects.service';
import {
  type CompanyTaskResponseDto,
  isTaskOverdue,
  type TaskAssigneeLoadDto,
  type TaskBoardSummaryDto,
  type TaskResponseDto,
  type TaskReviewItemDto,
  toCompanyTaskResponse,
  toTaskResponse,
  toTaskReviewItem,
  todayAsDateOnly,
} from './dto/project.response';
import {
  CreateTaskSubmissionDto,
  QueryTaskReviewsDto,
  ReviewTaskDto,
  type TaskReviewSortField,
  TaskReviewTab,
} from './dto/task-submission.dto';
import {
  CreateTaskDto,
  QueryCompanyTasksDto,
  QueryDueSoonTasksDto,
  QueryOverdueTasksDto,
  QueryTaskBoardDto,
  QueryTasksDto,
  UpdateTaskDto,
  UpdateTaskOrderDto,
  UpdateTaskStatusDto,
} from './dto/task.dto';

const SORTABLE_FIELDS = new Set([
  'id',
  'title',
  'status',
  'priority',
  'startDate',
  'dueDate',
  'sortOrder',
  'createdAt',
  'updatedAt',
]);

/**
 * ประกาศเป็นฟังก์ชัน ไม่ใช่ const ที่ใช้ร่วมกัน
 *
 * Sequelize แก้ไข object ของ include ในที่ตอน normalize (ยัด association ที่ resolve ได้
 * กลับเข้าไปใน object เดิม) ถ้าเอา object ตัวเดียวกันไปใช้ทั้งระดับบนและซ้อนใต้ include อื่น
 * ค่าที่ถูกยัดไว้จากรอบแรกจะไปปนกับรอบที่สอง จนได้ SQL ที่ join ผิดคอลัมน์
 */
function assigneeInclude() {
  return {
    model: User,
    as: 'assignedUser',
    attributes: ['id', 'username', 'fullName'],
    required: false,
    // งานเก่าที่มอบหมายให้คนที่ลาออกไปแล้ว ต้องยังเห็นชื่อได้ (BR-09)
    paranoid: false,
  };
}

function assignedByInclude() {
  return {
    model: User,
    as: 'assignedByUser',
    attributes: ['id', 'username', 'fullName'],
    required: false,
    paranoid: false,
  };
}

function submissionsInclude() {
  return {
    model: TaskSubmission,
    as: 'submissions',
    required: false,
    separate: true,
    order: [['createdAt', 'DESC']] as Order,
  };
}

function submittedByInclude() {
  return {
    model: User,
    as: 'submittedBy',
    attributes: ['id', 'username', 'fullName'],
    required: false,
    paranoid: false,
  };
}

function reviewedByInclude() {
  return {
    model: User,
    as: 'reviewedBy',
    attributes: ['id', 'username', 'fullName'],
    required: false,
    paranoid: false,
  };
}

/** โครงการที่งานสังกัด — ใช้กับรายการรวมทั้งบริษัทที่มีงานหลายโครงการปนกัน */
function projectInclude() {
  return {
    model: Project,
    attributes: ['id', 'code', 'name', 'status'],
    required: false,
  };
}

/** งานย่อยหนึ่งชั้น พร้อมผู้รับผิดชอบของแต่ละตัว */
function subTasksInclude() {
  return {
    model: Task,
    as: 'subTasks',
    required: false,
    include: [assigneeInclude()],
    separate: true,
    order: [['sortOrder', 'ASC']] as Order,
  };
}

/**
 * ลำดับของเมนูงานตรวจ — อ้างคอลัมน์ของตารางที่ join ผ่าน alias ของ Sequelize
 * (task, task->project) ได้เพราะทุก include เป็น belongsTo จึงไม่ถูกห่อเป็น subquery
 */
function reviewSortOrder(sortBy: TaskReviewSortField, direction: SortOrder): Order {
  const tieBreaker: [string, string] = ['id', direction];

  switch (sortBy) {
    case 'projectCode':
      return [
        // ไม่มีรหัสอยู่ท้ายเสมอไม่ว่าเรียงทางไหน
        [Sequelize.fn('ISNULL', Sequelize.col('task->project.code')), 'ASC'],
        [Sequelize.col('task->project.code'), direction],
        tieBreaker,
      ];
    case 'projectName':
      return [[Sequelize.col('task->project.name'), direction], tieBreaker];
    case 'taskTitle':
      return [[Sequelize.col('task.title'), direction], tieBreaker];
    case 'submittedAt':
      return [['createdAt', direction], tieBreaker];
    case 'reviewedAt':
      return [['reviewedAt', direction], tieBreaker];
    default: {
      const _exhaustive: never = sortBy;
      return _exhaustive;
    }
  }
}

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(Task) private readonly taskModel: typeof Task,
    @InjectModel(TaskSubmission) private readonly submissionModel: typeof TaskSubmission,
    @InjectModel(Project) private readonly projectModel: typeof Project,
    @InjectModel(Document) private readonly documentModel: typeof Document,
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly projectsService: ProjectsService,
    private readonly accessControl: AccessControlService,
    private readonly storage: StorageService,
  ) {}

  /**
   * รายการงานของโครงการ — คืนโครงสร้างซ้อน 2 ระดับเป็นค่าเริ่มต้น
   *
   * ระดับที่ 1 คืองานที่ไม่มีงานแม่ (parentTaskId = null) แต่ละตัวพ่วงงานย่อยชั้นเดียวมาด้วย
   * ชั้นที่ 3 ขึ้นไปมีอยู่จริงในฐานข้อมูลแต่ไม่ถูกคืนมาโดยอัตโนมัติ ให้เจาะดูด้วย
   * parentTaskId แทน เพื่อไม่ให้ payload บวมโดยที่หน้าจอส่วนใหญ่ไม่ได้ใช้
   */
  async findAllByProject(
    projectId: number,
    query: QueryTasksDto,
  ): Promise<PaginatedResult<TaskResponseDto>> {
    await this.projectsService.findOrFail(projectId);

    const where: WhereOptions<Task> = { projectId };

    // ไม่ได้เจาะดูงานย่อยชั้นลึก = แสดงเฉพาะงานระดับบนสุด
    if (query.parentTaskId !== undefined) {
      Object.assign(where, { parentTaskId: query.parentTaskId });
    } else {
      Object.assign(where, { parentTaskId: null });
    }

    if (query.status) {
      Object.assign(where, { status: query.status });
    }

    if (query.priority) {
      Object.assign(where, { priority: query.priority });
    }

    if (query.assignedUserId !== undefined) {
      Object.assign(where, { assignedUserId: query.assignedUserId });
    }

    if (query.search) {
      const like = '%' + query.search + '%';
      Object.assign(where, {
        [Op.or]: [{ title: { [Op.like]: like } }, { description: { [Op.like]: like } }],
      });
    }

    const sortBy = SORTABLE_FIELDS.has(query.sortBy ?? '') ? (query.sortBy as string) : 'sortOrder';
    const sortOrder = query.sortBy ? query.sortOrder : 'ASC';

    const { rows, count } = await this.taskModel.findAndCountAll({
      where,
      include: [assigneeInclude(), subTasksInclude()],
      distinct: true,
      order: [[sortBy, sortOrder]],
      limit: query.limit,
      offset: query.offset,
    });

    return toPaginatedResult(
      rows.map((task) => toTaskResponse(task)),
      count,
      query,
    );
  }

  async create(projectId: number, dto: CreateTaskDto): Promise<TaskResponseDto> {
    const actorId = getCurrentUserId();

    await this.projectsService.findOrFail(projectId);

    if (dto.parentTaskId) {
      await this.assertParentIsUsable(dto.parentTaskId, projectId);
    }

    if (dto.assignedUserId) {
      await this.assertAssigneeIsUsable(dto.assignedUserId);
      await this.assertCanAssign(actorId);
    }

    this.assertDateOrder(dto.startDate ?? null, dto.dueDate ?? null);

    const status = dto.status ?? TaskStatus.TODO;

    const task = await this.taskModel.create({
      projectId,
      parentTaskId: dto.parentTaskId ?? null,
      title: dto.title,
      description: dto.description ?? null,
      status,
      priority: dto.priority,
      assignedUserId: dto.assignedUserId ?? null,
      assignedByUserId: dto.assignedUserId ? actorId : null,
      startDate: dto.startDate ?? null,
      dueDate: dto.dueDate ?? null,
      // สร้างมาเป็น DONE เลยก็ได้ กรณีบันทึกงานที่ทำเสร็จไปแล้วย้อนหลัง
      completedAt: status === TaskStatus.DONE ? new Date() : null,
      estimatedHours: dto.estimatedHours ?? null,
      actualHours: dto.actualHours ?? null,
      sortOrder: dto.sortOrder ?? (await this.nextSortOrder(projectId, dto.parentTaskId ?? null)),
      createdBy: actorId,
      updatedBy: actorId,
    });

    return this.findOne(task.id);
  }

  async findOne(id: number): Promise<TaskResponseDto> {
    const task = await this.taskModel.findByPk(id, {
      include: [assigneeInclude(), assignedByInclude(), subTasksInclude(), submissionsInclude()],
    });

    if (!task) {
      throw new NotFoundException('ไม่พบข้อมูลงาน');
    }

    return toTaskResponse(task);
  }

  /** งานที่มอบหมายให้ผู้ใช้ปัจจุบัน — ไม่รับ user id จาก client */
  async findMyTasks(
    userId: number,
    query: PaginationDto,
  ): Promise<PaginatedResult<CompanyTaskResponseDto>> {
    const { rows, count } = await this.taskModel.findAndCountAll({
      where: {
        assignedUserId: userId,
        status: { [Op.notIn]: [TaskStatus.REVIEW, TaskStatus.DONE] },
      },
      include: [assigneeInclude(), assignedByInclude(), projectInclude()],
      order: [
        ['dueDate', 'ASC'],
        ['priority', 'DESC'],
        ['id', 'ASC'],
      ],
      limit: query.limit,
      offset: query.offset,
    });

    return toPaginatedResult(rows.map(toCompanyTaskResponse), count, query);
  }

  async update(projectId: number, id: number, dto: UpdateTaskDto): Promise<TaskResponseDto> {
    const actorId = getCurrentUserId();
    const task = await this.findOrFailInProject(projectId, id);

    if (dto.parentTaskId !== undefined && dto.parentTaskId !== null) {
      await this.assertParentIsUsable(dto.parentTaskId, projectId, id);
    }

    if (dto.assignedUserId) {
      await this.assertAssigneeIsUsable(dto.assignedUserId);
    }

    if (dto.assignedUserId !== undefined && dto.assignedUserId !== task.assignedUserId) {
      await this.assertCanAssign(actorId);
    }

    this.assertDateOrder(
      dto.startDate !== undefined ? (dto.startDate ?? null) : task.startDate,
      dto.dueDate !== undefined ? (dto.dueDate ?? null) : task.dueDate,
    );

    await task.update({
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.parentTaskId !== undefined ? { parentTaskId: dto.parentTaskId ?? null } : {}),
      ...(dto.description !== undefined ? { description: dto.description ?? null } : {}),
      ...(dto.status !== undefined ? this.statusPatch(task, dto.status) : {}),
      ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
      ...(dto.assignedUserId !== undefined
        ? {
            assignedUserId: dto.assignedUserId ?? null,
            assignedByUserId: dto.assignedUserId ? actorId : null,
          }
        : {}),
      ...(dto.startDate !== undefined ? { startDate: dto.startDate ?? null } : {}),
      ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate ?? null } : {}),
      ...(dto.estimatedHours !== undefined ? { estimatedHours: dto.estimatedHours ?? null } : {}),
      ...(dto.actualHours !== undefined ? { actualHours: dto.actualHours ?? null } : {}),
      ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      updatedBy: actorId,
    });

    return this.findOne(id);
  }

  /**
   * เปลี่ยนสถานะงาน
   *
   * ไม่บังคับลำดับ TODO -> DOING -> ... -> DONE โดยเจตนา เพราะงานจริงถอยกลับได้
   * เช่นตรวจแล้วไม่ผ่านต้องกลับไป DOING หรือถูกพักไว้เป็น WAITING กลางคัน
   * ถ้าบังคับลำดับตายตัว ผู้ใช้จะหาทางเลี่ยงด้วยการสร้างงานใหม่ ซึ่งทำให้ประวัติขาด
   */
  async updateStatus(id: number, dto: UpdateTaskStatusDto): Promise<TaskResponseDto> {
    const actorId = getCurrentUserId();
    const task = await this.findOrFail(id);

    if (dto.status === TaskStatus.REVIEW) {
      throw new BadRequestException('กรุณาส่งรายงานผ่านเส้นทางส่งตรวจ');
    }

    if (dto.status === TaskStatus.DONE && task.status === TaskStatus.REVIEW) {
      throw new BadRequestException('กรุณาตรวจงานผ่านเส้นทาง review');
    }

    this.assertStatusChangeAllowed(task, dto.status, actorId);

    await task.update({ ...this.statusPatch(task, dto.status), updatedBy: actorId });

    return this.findOne(id);
  }

  /** ผู้รับผิดชอบส่งงานให้ผู้มอบหมายตรวจ */
  async submitForReview(id: number): Promise<TaskResponseDto> {
    const actorId = getCurrentUserId();
    const task = await this.findOrFail(id);

    if (actorId === null) {
      throw new ForbiddenException('ไม่พบผู้ใช้ปัจจุบัน');
    }

    if (task.assignedUserId !== actorId) {
      throw new ForbiddenException('เฉพาะผู้รับผิดชอบเท่านั้นที่ส่งงานตรวจได้');
    }

    if (task.status === TaskStatus.DONE) {
      throw new ConflictException('งานนี้ตรวจผ่านแล้ว');
    }

    const submission = await this.submissionModel.findOne({
      where: { taskId: id, submittedByUserId: actorId, status: TaskSubmissionStatus.PENDING },
      order: [['createdAt', 'DESC']],
    });

    if (!submission) {
      throw new BadRequestException('กรุณาส่งรายงานผลการทำงานก่อนส่งตรวจ');
    }

    await task.update({ status: TaskStatus.REVIEW, completedAt: null, updatedBy: actorId });
    return this.findOne(id);
  }

  /** ผู้มอบหมายหรือผู้มีสิทธิ์ตรวจอนุมัติ/ส่งงานกลับแก้ไข */
  async review(id: number, dto: ReviewTaskDto, file?: UploadedFileLike): Promise<TaskResponseDto> {
    const actorId = getCurrentUserId();
    const task = await this.findOrFail(id);

    if (task.status !== TaskStatus.REVIEW) {
      throw new ConflictException('งานนี้ยังไม่อยู่ในสถานะรอตรวจ');
    }

    await this.assertCanReview(task, actorId);

    if (dto.status !== TaskStatus.DONE && dto.status !== TaskStatus.DOING) {
      throw new BadRequestException('ผลตรวจต้องเป็น DONE หรือ DOING เท่านั้น');
    }

    const submission = await this.submissionModel.findOne({
      where: { taskId: id, status: TaskSubmissionStatus.PENDING },
      order: [['createdAt', 'DESC']],
    });

    if (!submission) {
      throw new BadRequestException('ไม่พบรายงานที่รอตรวจ');
    }

    // ตรวจไฟล์ก่อนเปลี่ยนสถานะงาน — ไฟล์ผิดประเภทต้องไม่ทำให้งานถูกตรวจไปครึ่งทาง
    const reviewFileName = file ? assertUploadable(file) : null;
    const storedReviewFile = file
      ? await this.storage.put(
          buildStorageKey(`tasks/${id}/reviews`, reviewFileName as string),
          file.buffer,
          file.mimetype,
        )
      : null;

    await task.update({ ...this.statusPatch(task, dto.status), updatedBy: actorId });

    const finalStatus =
      dto.status === TaskStatus.DONE
        ? TaskSubmissionStatus.APPROVED
        : TaskSubmissionStatus.REJECTED;

    await submission.update({
      status: finalStatus,
      reviewedByUserId: actorId,
      reviewedAt: new Date(),
      reviewNote: dto.reviewNote ?? null,
      ...(storedReviewFile
        ? {
            reviewFileUrl: storedReviewFile.key,
            reviewFileName,
            reviewFileSize: file?.size ?? null,
            reviewMimeType: file?.mimetype ?? null,
          }
        : {}),
      updatedBy: actorId,
    });

    if (dto.status === TaskStatus.DONE && submission.fileUrl) {
      if (actorId === null) {
        throw new ForbiddenException('ไม่พบผู้ตรวจงานปัจจุบัน');
      }

      await this.attachApprovedSubmissionToProject(task, submission, actorId);
    }

    return this.findOne(id);
  }

  private async attachApprovedSubmissionToProject(
    task: Task,
    submission: TaskSubmission,
    actorId: number,
  ): Promise<void> {
    const project = await this.projectModel.findByPk(task.projectId, {
      attributes: ['id', 'customerId'],
    });

    if (!project) {
      return;
    }

    await this.documentModel.create({
      customerId: project.customerId,
      projectId: task.projectId,
      docType: DocumentType.OTHER,
      title: submission.fileName ?? `งาน-${task.id}-ไฟล์แนบ`,
      fileUrl: submission.fileUrl,
      fileName: submission.fileName ?? `งาน-${task.id}-ไฟล์แนบ`,
      fileSize: submission.fileSize ?? null,
      mimeType: submission.mimeType ?? null,
      note: `ไฟล์ที่ส่งมาจากงาน ${task.title ?? `#${task.id}`} — ${submission.report || 'ส่งรายงานเพื่อขอตรวจ'}`.slice(
        0,
        500,
      ),
      createdBy: actorId,
      updatedBy: actorId,
    });
  }

  private async assertCanReview(task: Task, actorId: number | null): Promise<void> {
    if (actorId === null) {
      throw new ForbiddenException('ไม่พบผู้ตรวจงานปัจจุบัน');
    }

    const actor = await this.userModel.findByPk(actorId, {
      attributes: ['id', 'accountType'],
    });

    if (!actor) {
      throw new ForbiddenException('ไม่พบผู้ตรวจงานปัจจุบัน');
    }

    if (actor.accountType === AccountType.SUPER_ADMIN || actor.accountType === AccountType.ADMIN) {
      return;
    }

    if (task.assignedUserId === actorId) {
      throw new ForbiddenException('ผู้รับผิดชอบไม่สามารถตรวจงานของตัวเองได้');
    }

    const project = await this.projectModel.findByPk(task.projectId, {
      attributes: ['id', 'managerUserId'],
    });

    if (task.assignedByUserId !== actorId && project?.managerUserId !== actorId) {
      throw new ForbiddenException('เฉพาะผู้มอบหมายหรือผู้จัดการโปรเจคเท่านั้นที่ตรวจงานได้');
    }
  }

  /** บันทึกรายงานของผู้รับผิดชอบหนึ่งรอบ ก่อนกดส่งตรวจ */
  async createSubmission(
    id: number,
    dto: CreateTaskSubmissionDto,
    file?: UploadedFileLike,
  ): Promise<TaskResponseDto> {
    const actorId = getCurrentUserId();
    const task = await this.findOrFail(id);

    if (actorId === null) {
      throw new ForbiddenException('ไม่พบผู้ใช้ปัจจุบัน');
    }

    if (task.assignedUserId !== actorId) {
      throw new ForbiddenException('เฉพาะผู้รับผิดชอบเท่านั้นที่ส่งรายงานได้');
    }

    if (task.status === TaskStatus.DONE || task.status === TaskStatus.REVIEW) {
      throw new ConflictException('งานนี้ยังส่งรายงานรอบใหม่ไม่ได้');
    }

    const fileName = file ? assertUploadable(file) : null;
    const stored = file
      ? await this.storage.put(
          buildStorageKey(`tasks/${id}/submissions`, fileName as string),
          file.buffer,
          file.mimetype,
        )
      : null;

    await this.submissionModel.create({
      taskId: id,
      submittedByUserId: actorId,
      report: dto.report,
      actualHours: dto.actualHours ?? null,
      fileUrl: stored?.key ?? null,
      fileName,
      fileSize: file?.size ?? null,
      mimeType: file?.mimetype ?? null,
      status: TaskSubmissionStatus.PENDING,
      createdBy: actorId,
      updatedBy: actorId,
    });

    return this.findOne(id);
  }

  async openSubmissionFile(
    id: number,
  ): Promise<StoredFileStream & { fileName: string; mimeType: string | null }> {
    const submission = await this.submissionModel.findByPk(id);

    if (!submission || !submission.fileUrl) {
      throw new NotFoundException('ไม่พบไฟล์รายงาน');
    }

    const file = await this.storage.get(submission.fileUrl);
    return {
      ...file,
      fileName: submission.fileName ?? `task-submission-${id}`,
      mimeType: submission.mimeType,
    };
  }

  /** ไฟล์ที่ผู้ตรวจแนบตอนส่งกลับแก้ */
  async openReviewFile(
    id: number,
  ): Promise<StoredFileStream & { fileName: string; mimeType: string | null }> {
    const submission = await this.submissionModel.findByPk(id);

    if (!submission || !submission.reviewFileUrl) {
      throw new NotFoundException('ไม่พบไฟล์แนบของผู้ตรวจ');
    }

    const file = await this.storage.get(submission.reviewFileUrl);
    return {
      ...file,
      fileName: submission.reviewFileName ?? `task-review-${id}`,
      mimeType: submission.reviewMimeType,
    };
  }

  /**
   * เมนู "งานตรวจ" (ประชุมทบทวน 22–23 ก.ย. นาที 00:12–00:13) — หนึ่งแถวต่อรายงานหนึ่งรอบ
   *
   * PENDING = รายงานที่ยังรอตรวจของงานที่อยู่ในสถานะ REVIEW และฉันมีสิทธิ์ตรวจ
   * (ขอบเขตเดียวกับ GET /tasks?status=REVIEW) · REVIEWED = รายงานที่ฉันเป็นผู้ตรวจ
   * — ADMIN ก็เห็นเฉพาะที่ตัวเองตรวจ เพราะแท็บนี้คือ "ประวัติการตรวจของฉัน"
   */
  async findReviews(
    query: QueryTaskReviewsDto,
    user: AuthenticatedUser,
  ): Promise<PaginatedResult<TaskReviewItemDto>> {
    const taskWhere: WhereOptions<Task> = {};
    // ขอบเขตผู้ตรวจกับคำค้นต่างใช้ Op.or — รวมใต้ Op.and ไม่ให้ทับกัน
    const taskConditions: WhereOptions<Task>[] = [];
    let filterByTask = false;

    if (query.projectId !== undefined) {
      Object.assign(taskWhere, { projectId: query.projectId });
      filterByTask = true;
    }

    if (query.search) {
      const like = '%' + query.search + '%';
      // รหัสโครงการมีหลายรูปแบบปนกัน (PRJ-2026-002 / PRJ69-0001) ค้นตามค่าที่เก็บจริง
      const projects = await this.projectModel.findAll({
        where: { [Op.or]: [{ code: { [Op.like]: like } }, { name: { [Op.like]: like } }] },
        attributes: ['id'],
      });
      const projectIds = projects.map((project) => project.id);
      taskConditions.push({
        [Op.or]: [
          { title: { [Op.like]: like } },
          ...(projectIds.length > 0 ? [{ projectId: { [Op.in]: projectIds } }] : []),
        ],
      });
      filterByTask = true;
    }

    const where: WhereOptions<TaskSubmission> = {};
    let order: Order;

    if (query.tab === TaskReviewTab.REVIEWED) {
      Object.assign(where, {
        reviewedByUserId: user.id,
        status: query.result ?? {
          [Op.in]: [TaskSubmissionStatus.APPROVED, TaskSubmissionStatus.REJECTED],
        },
      });
      order = [
        ['reviewedAt', 'DESC'],
        ['id', 'DESC'],
      ];
    } else {
      Object.assign(where, { status: TaskSubmissionStatus.PENDING });
      Object.assign(taskWhere, { status: TaskStatus.REVIEW });
      filterByTask = true;
      const scope = await this.reviewerScope(user);
      if (scope) {
        taskConditions.push(scope);
      }
      // รอนานที่สุดขึ้นก่อน
      order = [
        ['createdAt', 'ASC'],
        ['id', 'ASC'],
      ];
    }

    if (query.sortBy) {
      order = reviewSortOrder(query.sortBy, query.sortOrder);
    }

    if (taskConditions.length > 0) {
      Object.assign(taskWhere, { [Op.and]: taskConditions });
    }

    // หา id ของงานก่อนแล้วกรองด้วย IN — findAndCountAll ที่มี limit + include
    // อาจถูกห่อเป็น subquery จนเงื่อนไขของตารางที่ join หายจาก WHERE
    if (filterByTask) {
      const tasks = await this.taskModel.findAll({ where: taskWhere, attributes: ['id'] });
      Object.assign(where, { taskId: { [Op.in]: tasks.map((task) => task.id) } });
    }

    const { rows, count } = await this.submissionModel.findAndCountAll({
      where,
      include: [
        {
          model: Task,
          attributes: ['id', 'title', 'status', 'priority', 'dueDate', 'projectId'],
          required: true,
          include: [projectInclude()],
        },
        submittedByInclude(),
        reviewedByInclude(),
      ],
      order,
      limit: query.limit,
      offset: query.offset,
      distinct: true,
    });

    return toPaginatedResult(rows.map(toTaskReviewItem), count, query);
  }

  /** badge เมนูงานตรวจ — เรียก findReviews() ตัวเดียวกัน ตัวเลขจึงเท่ากับ total ของแท็บรอตรวจ */
  async countPendingReviews(user: AuthenticatedUser): Promise<number> {
    const query = Object.assign(new QueryTaskReviewsDto(), { page: 1, limit: 1 });
    return (await this.findReviews(query, user)).total;
  }

  /**
   * badge เมนูงานโปรเจกต์ — งานของฉัน (DOING / WAITING) ที่รอบส่งล่าสุดถูกตีกลับ
   * เป็นส่วนหนึ่งของ GET /tasks/me เสมอ เพราะรายการนั้นตัดแค่ REVIEW กับ DONE
   */
  async countRejectedMyTasks(userId: number): Promise<number> {
    const tasks = await this.taskModel.findAll({
      where: {
        assignedUserId: userId,
        status: { [Op.in]: [TaskStatus.DOING, TaskStatus.WAITING] },
      },
      attributes: ['id'],
    });

    if (tasks.length === 0) {
      return 0;
    }

    const submissions = await this.submissionModel.findAll({
      where: { taskId: { [Op.in]: tasks.map((task) => task.id) } },
      attributes: ['id', 'taskId', 'status'],
      order: [
        ['createdAt', 'DESC'],
        ['id', 'DESC'],
      ],
    });

    const latestByTask = new Map<number, TaskSubmissionStatus>();
    for (const submission of submissions) {
      if (!latestByTask.has(submission.taskId)) {
        latestByTask.set(submission.taskId, submission.status);
      }
    }

    return [...latestByTask.values()].filter((status) => status === TaskSubmissionStatus.REJECTED)
      .length;
  }

  /**
   * ขอบเขตงานที่ USER ตรวจได้ — งานที่ตัวเองมอบหมาย หรืองานในโครงการที่ตัวเองเป็นผู้จัดการ
   * คืน null = ตรวจได้ทุกงาน (SUPER_ADMIN / ADMIN) · ไม่มีสิทธิ์ task.review = 403
   */
  private async reviewerScope(user: AuthenticatedUser): Promise<WhereOptions<Task> | null> {
    if (!(await this.accessControl.hasPermission(user, 'task.review'))) {
      throw new ForbiddenException('คุณไม่มีสิทธิ์ตรวจงาน');
    }

    if (user.accountType !== AccountType.USER) {
      return null;
    }

    const managedProjects = await this.projectModel.findAll({
      where: { managerUserId: user.id },
      attributes: ['id'],
    });
    const projectIds = managedProjects.map((project) => project.id);
    return {
      [Op.or]: [
        { assignedByUserId: user.id },
        ...(projectIds.length > 0 ? [{ projectId: { [Op.in]: projectIds } }] : []),
      ],
    };
  }

  /**
   * ลากจัดลำดับ — รับตำแหน่งปลายทาง แล้วเรียงพี่น้องทั้งกลุ่มใหม่เป็น 0, 1, 2, ...
   *
   * เขียนค่าใหม่ให้ทุกตัวในกลุ่มแทนที่จะแก้เฉพาะตัวที่ย้าย เพราะถ้าแก้ตัวเดียว
   * ค่าจะชนกันเรื่อย ๆ จนลำดับเพี้ยนหลังลากไปมาหลายรอบ การเขียนใหม่ทั้งกลุ่ม
   * ทำให้ลำดับถูกต้องเสมอไม่ว่าสภาพก่อนหน้าจะเป็นอย่างไร
   */
  async updateOrder(id: number, dto: UpdateTaskOrderDto): Promise<TaskResponseDto> {
    const actorId = getCurrentUserId();
    const task = await this.findOrFail(id);

    await this.sequelize.transaction(async (transaction) => {
      const siblings = await this.taskModel.findAll({
        where: { projectId: task.projectId, parentTaskId: task.parentTaskId },
        order: [
          ['sortOrder', 'ASC'],
          ['id', 'ASC'],
        ],
        transaction,
      });

      const reordered = siblings.filter((sibling) => sibling.id !== task.id);
      const target = Math.min(dto.sortOrder, reordered.length);
      reordered.splice(target, 0, task);

      for (const [index, sibling] of reordered.entries()) {
        if (sibling.sortOrder !== index) {
          // อัปเดตทีละแถวผ่าน instance เพื่อให้ audit hook บันทึก record_id ได้ (BR-09)
          await sibling.update({ sortOrder: index, updatedBy: actorId }, { transaction });
        }
      }
    });

    return this.findOne(id);
  }

  /**
   * งานที่เกินกำหนด — dueDate ผ่านไปแล้วและสถานะยังไม่ใช่ DONE
   * เป็นตัวป้อนให้ notification rule แบบ TASK_OVERDUE ใน Phase 11
   */
  async findOverdue(query: QueryOverdueTasksDto): Promise<PaginatedResult<TaskResponseDto>> {
    const where: WhereOptions<Task> = {
      dueDate: { [Op.lt]: todayAsDateOnly() },
      status: { [Op.ne]: TaskStatus.DONE },
    };

    if (query.projectId !== undefined) {
      Object.assign(where, { projectId: query.projectId });
    }

    if (query.assignedUserId !== undefined) {
      Object.assign(where, { assignedUserId: query.assignedUserId });
    }

    const { rows, count } = await this.taskModel.findAndCountAll({
      where,
      include: [assigneeInclude()],
      // ค้างนานสุดขึ้นก่อน แล้วงานด่วนขึ้นก่อนในวันเดียวกัน
      order: [
        ['dueDate', 'ASC'],
        ['priority', 'DESC'],
      ],
      limit: query.limit,
      offset: query.offset,
    });

    return toPaginatedResult(
      rows.map((task) => toTaskResponse(task, false)),
      count,
      query,
    );
  }

  /**
   * M2-06 งานใกล้ครบกำหนด — ครบกำหนดตั้งแต่วันนี้ถึงอีก N วัน และยังไม่ DONE
   *
   * ขอบล่างคือ "วันนี้" ไม่ใช่เมื่อวาน เพื่อให้ต่อกับ findOverdue() พอดีไม่ซ้อนไม่เว้น —
   * งานที่ครบกำหนดวันนี้ยังไม่เกินกำหนด (กติกา Phase 5) จึงต้องมาอยู่ในรายการนี้แทน
   */
  async findDueSoon(query: QueryDueSoonTasksDto): Promise<PaginatedResult<TaskResponseDto>> {
    const today = todayAsDateOnly();
    const where: WhereOptions<Task> = {
      dueDate: { [Op.between]: [today, addDays(today, query.withinDays)] },
      status: { [Op.ne]: TaskStatus.DONE },
    };

    if (query.projectId !== undefined) {
      Object.assign(where, { projectId: query.projectId });
    }

    if (query.assignedUserId !== undefined) {
      Object.assign(where, { assignedUserId: query.assignedUserId });
    }

    const { rows, count } = await this.taskModel.findAndCountAll({
      where,
      include: [assigneeInclude()],
      // ใกล้ครบกำหนดที่สุดขึ้นก่อน แล้วงานด่วนขึ้นก่อนในวันเดียวกัน — ลำดับเดียวกับงานเกินกำหนด
      order: [
        ['dueDate', 'ASC'],
        ['priority', 'DESC'],
      ],
      limit: query.limit,
      offset: query.offset,
    });

    return toPaginatedResult(
      rows.map((task) => toTaskResponse(task, false)),
      count,
      query,
    );
  }

  /**
   * M2-07 รายการงานทั้งบริษัท (ข้ามโครงการ) — แบบแบน นับงานย่อยทุกชั้นเป็นหนึ่งงาน
   *
   * ต่างจาก findAllByProject() ที่คืนโครงสร้างซ้อน เพราะหน้าจอรวมใช้ดูว่า "อะไรติดอยู่ที่ไหน"
   * ไม่ได้ใช้ดูโครงสร้างงาน ถ้าคืนแบบซ้อน งานย่อยที่ค้างจะถูกซ่อนอยู่ใต้งานแม่ที่อาจเสร็จไปแล้ว
   */
  async findCompanyTasks(
    query: QueryCompanyTasksDto,
    user?: AuthenticatedUser,
  ): Promise<PaginatedResult<CompanyTaskResponseDto>> {
    const where: WhereOptions<Task> = {};

    if (query.projectId !== undefined) {
      Object.assign(where, { projectId: query.projectId });
    }

    if (query.assignedUserId !== undefined) {
      Object.assign(where, { assignedUserId: query.assignedUserId });
    }

    if (query.status) {
      Object.assign(where, { status: query.status });
    }

    if (query.status === TaskStatus.REVIEW && user) {
      const scope = await this.reviewerScope(user);
      if (scope) {
        // ห่อด้วย Op.and — ?search= ด้านล่างใช้คีย์ Op.or เหมือนกัน ถ้าวางตรง ๆ จะทับกัน
        Object.assign(where, { [Op.and]: [scope] });
      }
    }

    if (query.priority) {
      Object.assign(where, { priority: query.priority });
    }

    if (query.search) {
      const like = '%' + query.search + '%';
      Object.assign(where, {
        [Op.or]: [{ title: { [Op.like]: like } }, { description: { [Op.like]: like } }],
      });
    }

    const order: Order = SORTABLE_FIELDS.has(query.sortBy ?? '')
      ? [
          [query.sortBy as string, query.sortOrder],
          ['id', 'ASC'],
        ]
      : [
          // งานที่ไม่มีวันครบกำหนดไปไว้ท้าย — MySQL เรียง NULL ขึ้นก่อนเสมอถ้าไม่บอก
          [Sequelize.fn('ISNULL', Sequelize.col('Task.due_date')), 'ASC'],
          ['dueDate', 'ASC'],
          ['priority', 'DESC'],
          ['id', 'ASC'],
        ];

    const { rows, count } = await this.taskModel.findAndCountAll({
      where,
      include: [assigneeInclude(), assignedByInclude(), projectInclude()],
      order,
      limit: query.limit,
      offset: query.offset,
    });

    return toPaginatedResult(rows.map(toCompanyTaskResponse), count, query);
  }

  /**
   * M2-07 สรุปภาพรวมงานทั้งบริษัท — แยกตามสถานะ งานเกินกำหนดแยกตามสถานะ และภาระงานรายคน
   *
   * รวมใน JavaScript จากแถวที่ดึงมาเฉพาะคอลัมน์ที่ใช้ แทนการ GROUP BY หลายชั้นใน SQL
   * เพราะปริมาณงานของบริษัทขนาดนี้ไม่มากพอให้คุ้ม และสูตร "เกินกำหนด" จะมาจาก
   * isTaskOverdue() ตัวเดียวกับที่ใช้ทั้งระบบ ไม่มีโอกาสนับไม่ตรงกับ flag isOverdue ในรายการ
   */
  async summarizeBoard(query: QueryTaskBoardDto): Promise<TaskBoardSummaryDto> {
    const where: WhereOptions<Task> = {};

    if (query.projectId !== undefined) {
      Object.assign(where, { projectId: query.projectId });
    }

    const tasks = await this.taskModel.findAll({
      where,
      attributes: ['id', 'status', 'dueDate', 'assignedUserId'],
    });

    const openStatuses = Object.values(TaskStatus).filter((status) => status !== TaskStatus.DONE);
    const zeroes = (statuses: TaskStatus[]) =>
      Object.fromEntries(statuses.map((status) => [status, 0])) as Record<string, number>;

    const byStatus = zeroes(Object.values(TaskStatus));
    const overdueByStatus = zeroes(openStatuses);
    const loads = new Map<
      number | null,
      { openTasks: number; overdueTasks: number; byStatus: Record<string, number> }
    >();

    let overdueTasks = 0;

    for (const task of tasks) {
      byStatus[task.status] += 1;

      if (task.status === TaskStatus.DONE) {
        continue;
      }

      const overdue = isTaskOverdue(task);
      const load = loads.get(task.assignedUserId) ?? {
        openTasks: 0,
        overdueTasks: 0,
        byStatus: zeroes(openStatuses),
      };

      load.openTasks += 1;
      load.byStatus[task.status] += 1;

      if (overdue) {
        overdueTasks += 1;
        overdueByStatus[task.status] += 1;
        load.overdueTasks += 1;
      }

      loads.set(task.assignedUserId, load);
    }

    const userIds = [...loads.keys()].filter((id): id is number => id !== null);
    const users =
      userIds.length === 0
        ? []
        : await this.userModel.findAll({
            where: { id: userIds },
            attributes: ['id', 'fullName'],
            // งานเก่าที่ค้างอยู่กับคนที่ลาออกไปแล้วต้องยังเห็นชื่อ ไม่งั้นจะหาไม่เจอว่าใครต้องส่งต่อ
            paranoid: false,
          });
    const names = new Map(users.map((user) => [user.id, user.fullName]));

    const byAssignee: TaskAssigneeLoadDto[] = [...loads.entries()]
      .map(([assignedUserId, load]) => ({
        assignedUserId,
        fullName: assignedUserId === null ? null : (names.get(assignedUserId) ?? null),
        ...load,
      }))
      .sort((a, b) => b.overdueTasks - a.overdueTasks || b.openTasks - a.openTasks);

    return {
      totalTasks: tasks.length,
      openTasks: tasks.length - byStatus[TaskStatus.DONE],
      overdueTasks,
      byStatus,
      overdueByStatus,
      byAssignee,
    };
  }

  /** ลบงาน — soft delete พร้อมงานย่อยทุกชั้นที่อยู่ใต้มัน */
  async remove(projectId: number, id: number): Promise<void> {
    const actorId = getCurrentUserId();
    const task = await this.findOrFailInProject(projectId, id);

    await this.sequelize.transaction(async (transaction) => {
      await this.removeWithDescendants(task, actorId, transaction);
    });
  }

  // ---- helpers -------------------------------------------------------------

  private async findOrFail(id: number): Promise<Task> {
    const task = await this.taskModel.findByPk(id);

    if (!task) {
      throw new NotFoundException('ไม่พบข้อมูลงาน');
    }

    return task;
  }

  /** กันการแก้งานของโครงการอื่นผ่าน URL ของโครงการนี้ */
  private async findOrFailInProject(projectId: number, id: number): Promise<Task> {
    const task = await this.findOrFail(id);

    if (task.projectId !== projectId) {
      throw new NotFoundException('ไม่พบงานนี้ในโครงการที่ระบุ');
    }

    return task;
  }

  /** ตั้งหรือล้าง completedAt ให้สอดคล้องกับสถานะเสมอ */
  private statusPatch(
    task: Task,
    status: TaskStatus,
  ): { status: TaskStatus; completedAt: Date | null } {
    if (status === TaskStatus.DONE) {
      // เปลี่ยนเป็น DONE ซ้ำไม่ทับเวลาเดิม จะได้รู้ว่าเสร็จจริงเมื่อไร
      return { status, completedAt: task.completedAt ?? new Date() };
    }

    return { status, completedAt: null };
  }

  private async nextSortOrder(projectId: number, parentTaskId: number | null): Promise<number> {
    const count = await this.taskModel.count({ where: { projectId, parentTaskId } });
    return count;
  }

  /**
   * งานแม่ต้องอยู่ในโครงการเดียวกัน และต้องไม่ทำให้เกิดวงกลม
   * (งาน A เป็นลูกของ B ที่เป็นลูกของ A) ซึ่งจะทำให้การไล่โครงสร้างวนไม่รู้จบ
   */
  private async assertParentIsUsable(
    parentTaskId: number,
    projectId: number,
    movingTaskId?: number,
  ): Promise<void> {
    const parent = await this.taskModel.findByPk(parentTaskId, {
      attributes: ['id', 'projectId', 'parentTaskId'],
    });

    if (!parent) {
      throw new BadRequestException('ไม่พบงานแม่ที่ระบุ');
    }

    if (parent.projectId !== projectId) {
      throw new BadRequestException('งานแม่ต้องอยู่ในโครงการเดียวกัน');
    }

    if (movingTaskId === undefined) {
      return;
    }

    if (parentTaskId === movingTaskId) {
      throw new BadRequestException('ตั้งให้งานเป็นงานแม่ของตัวเองไม่ได้');
    }

    // ไล่ขึ้นไปตามสายงานแม่ ถ้าเจอตัวเองแปลว่ากำลังจะสร้างวงกลม
    let cursor: number | null = parent.parentTaskId;

    while (cursor !== null) {
      if (cursor === movingTaskId) {
        throw new BadRequestException('ย้ายงานไปอยู่ใต้งานย่อยของตัวเองไม่ได้');
      }

      const ancestor: Task | null = await this.taskModel.findByPk(cursor, {
        attributes: ['id', 'parentTaskId'],
      });

      cursor = ancestor ? ancestor.parentTaskId : null;
    }
  }

  private async assertAssigneeIsUsable(assignedUserId: number): Promise<void> {
    const user = await this.userModel.findByPk(assignedUserId, {
      attributes: ['id', 'username', 'accountType', 'status'],
    });

    if (!user) {
      throw new BadRequestException('ไม่พบพนักงานที่ระบุเป็นผู้รับผิดชอบ');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('พนักงานที่ระบุไม่ได้อยู่ในสถานะใช้งาน จึงมอบหมายงานให้ไม่ได้');
    }

    const canWork = await Promise.all(
      ['task.view', 'task.update'].map((permission) =>
        this.accessControl.hasPermission(user, permission),
      ),
    );

    if (!canWork.every(Boolean)) {
      throw new BadRequestException('พนักงานที่ระบุไม่มีสิทธิ์ทำงานประเภทนี้');
    }
  }

  private async assertCanAssign(actorId: number | null): Promise<void> {
    if (actorId === null) {
      throw new ForbiddenException('ไม่พบผู้มอบหมายงาน');
    }

    const actor = await this.userModel.findByPk(actorId, {
      attributes: ['id', 'username', 'accountType'],
    });

    if (!actor || !(await this.accessControl.hasPermission(actor, 'task.assign'))) {
      throw new ForbiddenException('คุณไม่มีสิทธิ์มอบหมายงาน');
    }
  }

  private assertStatusChangeAllowed(task: Task, status: TaskStatus, actorId: number | null): void {
    if (status === TaskStatus.REVIEW) {
      if (task.assignedUserId !== actorId) {
        throw new ForbiddenException('เฉพาะผู้รับผิดชอบเท่านั้นที่ส่งงานตรวจได้');
      }
      return;
    }

    if (status === TaskStatus.DONE) {
      if (task.status !== TaskStatus.REVIEW) {
        throw new ConflictException('ต้องส่งงานตรวจสอบก่อนจึงจะปิดงานได้');
      }
      if (task.assignedUserId === actorId) {
        throw new ForbiddenException('ผู้รับผิดชอบไม่สามารถตรวจงานของตัวเองได้');
      }
      return;
    }

    if (task.status === TaskStatus.REVIEW && task.assignedUserId === actorId) {
      throw new ForbiddenException('งานที่ส่งตรวจแล้วต้องรอผลตรวจจากผู้มอบหมาย');
    }
  }

  private assertDateOrder(startDate: string | null, dueDate: string | null): void {
    if (startDate && dueDate && startDate > dueDate) {
      throw new BadRequestException('วันเริ่มงานต้องไม่อยู่หลังวันครบกำหนด');
    }
  }

  private async removeWithDescendants(
    task: Task,
    actorId: number | null,
    transaction: Transaction,
  ): Promise<void> {
    const children = await this.taskModel.findAll({
      where: { parentTaskId: task.id },
      transaction,
    });

    for (const child of children) {
      await this.removeWithDescendants(child, actorId, transaction);
    }

    await task.update({ deletedBy: actorId }, { transaction });
    await task.destroy({ transaction });
  }
}
