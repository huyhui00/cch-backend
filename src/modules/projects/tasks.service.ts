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
  type MyTaskCountsDto,
  type MyTasksResponseDto,
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
  MyTaskTab,
  QueryCompanyTasksDto,
  QueryMyTasksDto,
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

function projectInclude() {
  return {
    model: Project,
    attributes: ['id', 'code', 'name', 'status'],
    required: false,
  };
}

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

function reviewSortOrder(sortBy: TaskReviewSortField, direction: SortOrder): Order {
  const tieBreaker: [string, string] = ['id', direction];

  switch (sortBy) {
    case 'projectCode':
      return [
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

  async findAllByProject(
    projectId: number,
    query: QueryTasksDto,
  ): Promise<PaginatedResult<TaskResponseDto>> {
    await this.projectsService.findOrFail(projectId);

    const where: WhereOptions<Task> = { projectId };

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

    if (status === TaskStatus.REVIEW) {
      throw new BadRequestException('สร้างงานเป็นสถานะส่งตรวจไม่ได้ กรุณาส่งตรวจหลังสร้างงาน');
    }

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

  async findMyTasks(userId: number, query: QueryMyTasksDto): Promise<MyTasksResponseDto> {
    const tab = query.tab ?? MyTaskTab.OPEN;
    const searchWhere = this.myTasksSearchWhere(query.search);

    const [{ rows, count }, counts] = await Promise.all([
      this.taskModel.findAndCountAll({
        where: { ...this.myTasksWhere(userId, tab), ...searchWhere },
        include: [assigneeInclude(), assignedByInclude(), projectInclude()],
        order:
          tab === MyTaskTab.DONE
            ? [
                ['completedAt', 'DESC'],
                ['id', 'DESC'],
              ]
            : [
                ['dueDate', 'ASC'],
                ['priority', 'DESC'],
                ['id', 'ASC'],
              ],
        limit: query.limit,
        offset: query.offset,
      }),
      this.countMyTasksByTab(userId, searchWhere),
    ]);

    return {
      ...toPaginatedResult(rows.map(toCompanyTaskResponse), count, query),
      counts,
    };
  }

  myTasksWhere(userId: number, tab: MyTaskTab): WhereOptions<Task> {
    switch (tab) {
      case MyTaskTab.OPEN:
        return this.myOpenTasksWhere(userId);
      case MyTaskTab.TODO:
        return { assignedUserId: userId, status: TaskStatus.TODO };
      case MyTaskTab.IN_PROGRESS:
        return {
          assignedUserId: userId,
          status: { [Op.in]: [TaskStatus.DOING, TaskStatus.WAITING] },
        };
      case MyTaskTab.REVIEW:
        return { assignedUserId: userId, status: TaskStatus.REVIEW };
      case MyTaskTab.DONE:
        return { assignedUserId: userId, status: TaskStatus.DONE };
      case MyTaskTab.OVERDUE:
        return {
          assignedUserId: userId,
          dueDate: { [Op.lt]: todayAsDateOnly() },
          status: { [Op.ne]: TaskStatus.DONE },
        };
      case MyTaskTab.ALL:
        return { assignedUserId: userId };
      default: {
        const _exhaustive: never = tab;
        return _exhaustive;
      }
    }
  }

  private myTasksSearchWhere(search: string | undefined): WhereOptions<Task> {
    if (!search) {
      return {};
    }

    const like = '%' + search + '%';
    return { [Op.or]: [{ title: { [Op.like]: like } }, { description: { [Op.like]: like } }] };
  }

  private async countMyTasksByTab(
    userId: number,
    searchWhere: WhereOptions<Task>,
  ): Promise<MyTaskCountsDto> {
    const [grouped, overdue] = await Promise.all([
      this.taskModel.findAll({
        where: { assignedUserId: userId, ...searchWhere },
        attributes: ['status', [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']],
        group: ['status'],
        raw: true,
      }) as unknown as Promise<Array<{ status: TaskStatus; count: number | string }>>,
      this.taskModel.count({
        where: { ...this.myTasksWhere(userId, MyTaskTab.OVERDUE), ...searchWhere },
      }),
    ]);

    const byStatus = new Map(grouped.map((row) => [row.status, Number(row.count)]));
    const of = (status: TaskStatus) => byStatus.get(status) ?? 0;
    const todo = of(TaskStatus.TODO);
    const inProgress = of(TaskStatus.DOING) + of(TaskStatus.WAITING);
    const review = of(TaskStatus.REVIEW);
    const done = of(TaskStatus.DONE);

    return {
      OPEN: todo + inProgress,
      TODO: todo,
      IN_PROGRESS: inProgress,
      REVIEW: review,
      DONE: done,
      OVERDUE: overdue,
      ALL: todo + inProgress + review + done,
    };
  }

  countMyOpenTasks(userId: number): Promise<number> {
    return this.taskModel.count({ where: this.myOpenTasksWhere(userId) });
  }

  myOpenTasksWhere(userId: number): WhereOptions<Task> {
    return {
      assignedUserId: userId,
      status: { [Op.notIn]: [TaskStatus.REVIEW, TaskStatus.DONE] },
    };
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

    if (dto.status !== undefined && dto.status !== task.status) {
      this.assertManualStatusChange(task, dto.status, actorId);
    }

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

    this.assertManualStatusChange(task, dto.status, actorId);

    await task.update({ ...this.statusPatch(task, dto.status), updatedBy: actorId });

    return this.findOne(id);
  }

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

  async findReviews(
    query: QueryTaskReviewsDto,
    user: AuthenticatedUser,
  ): Promise<PaginatedResult<TaskReviewItemDto>> {
    const taskWhere: WhereOptions<Task> = {};
    const taskConditions: WhereOptions<Task>[] = [];
    let filterByTask = false;

    if (query.projectId !== undefined) {
      Object.assign(taskWhere, { projectId: query.projectId });
      filterByTask = true;
    }

    if (query.search) {
      const like = '%' + query.search + '%';
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

  async countPendingReviews(user: AuthenticatedUser): Promise<number> {
    const query = Object.assign(new QueryTaskReviewsDto(), { page: 1, limit: 1 });
    return (await this.findReviews(query, user)).total;
  }

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

    // คนที่ไม่มี task.review ยังเห็นคอลัมน์ "ส่งตรวจ" บนกระดานได้เหมือนคอลัมน์อื่น — จำกัดขอบเขตเฉพาะผู้ตรวจ
    if (
      query.status === TaskStatus.REVIEW &&
      user &&
      (await this.accessControl.hasPermission(user, 'task.review'))
    ) {
      const scope = await this.reviewerScope(user);
      if (scope) {
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

  async remove(projectId: number, id: number): Promise<void> {
    const actorId = getCurrentUserId();
    const task = await this.findOrFailInProject(projectId, id);

    await this.sequelize.transaction(async (transaction) => {
      await this.removeWithDescendants(task, actorId, transaction);
    });
  }

  private async findOrFail(id: number): Promise<Task> {
    const task = await this.taskModel.findByPk(id);

    if (!task) {
      throw new NotFoundException('ไม่พบข้อมูลงาน');
    }

    return task;
  }

  private async findOrFailInProject(projectId: number, id: number): Promise<Task> {
    const task = await this.findOrFail(id);

    if (task.projectId !== projectId) {
      throw new NotFoundException('ไม่พบงานนี้ในโครงการที่ระบุ');
    }

    return task;
  }

  private statusPatch(
    task: Task,
    status: TaskStatus,
  ): { status: TaskStatus; completedAt: Date | null } {
    if (status === TaskStatus.DONE) {
      return { status, completedAt: task.completedAt ?? new Date() };
    }

    return { status, completedAt: null };
  }

  private async nextSortOrder(projectId: number, parentTaskId: number | null): Promise<number> {
    const count = await this.taskModel.count({ where: { projectId, parentTaskId } });
    return count;
  }

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

  private assertManualStatusChange(task: Task, status: TaskStatus, actorId: number | null): void {
    if (status === TaskStatus.REVIEW) {
      throw new BadRequestException('กรุณาส่งรายงานผ่านเส้นทางส่งตรวจ');
    }

    if (status === TaskStatus.DONE && task.status === TaskStatus.REVIEW) {
      throw new BadRequestException('กรุณาตรวจงานผ่านเส้นทาง review');
    }

    this.assertStatusChangeAllowed(task, status, actorId);
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
