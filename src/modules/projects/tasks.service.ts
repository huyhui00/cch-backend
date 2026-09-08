import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, type Order, type Transaction, type WhereOptions } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { getCurrentUserId } from '../../common/context/request-context';
import { type PaginatedResult, toPaginatedResult } from '../../common/dto/pagination.dto';
import { Task, TaskStatus, User, UserStatus } from '../../models';
import { ProjectsService } from './projects.service';
import { type TaskResponseDto, toTaskResponse, todayAsDateOnly } from './dto/project.response';
import {
  CreateTaskDto,
  QueryOverdueTasksDto,
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

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(Task) private readonly taskModel: typeof Task,
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly projectsService: ProjectsService,
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
      include: [assigneeInclude(), subTasksInclude()],
    });

    if (!task) {
      throw new NotFoundException('ไม่พบข้อมูลงาน');
    }

    return toTaskResponse(task);
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
      ...(dto.assignedUserId !== undefined ? { assignedUserId: dto.assignedUserId ?? null } : {}),
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

    await task.update({ ...this.statusPatch(task, dto.status), updatedBy: actorId });

    return this.findOne(id);
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
    const user = await this.userModel.findByPk(assignedUserId, { attributes: ['id', 'status'] });

    if (!user) {
      throw new BadRequestException('ไม่พบพนักงานที่ระบุเป็นผู้รับผิดชอบ');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('พนักงานที่ระบุไม่ได้อยู่ในสถานะใช้งาน จึงมอบหมายงานให้ไม่ได้');
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
