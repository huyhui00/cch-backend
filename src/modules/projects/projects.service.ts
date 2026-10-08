import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { col, fn, literal, Op, type OrderItem, type WhereOptions } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { getCurrentUserId } from '../../common/context/request-context';
import { type PaginatedResult, toPaginatedResult } from '../../common/dto/pagination.dto';
import { AccessControlService } from '../../common/services/access-control.service';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { nextGeneratedCode } from '../../common/utils/code-sequence.util';
import {
  Customer,
  Delivery,
  MaContract,
  Project,
  Task,
  TaskStatus,
  Ticket,
  User,
  UserStatus,
} from '../../models';
import { CustomersService } from '../customers/customers.service';
import {
  CreateProjectDto,
  QueryProjectOptionsDto,
  QueryProjectsDto,
  UpdateProjectDto,
} from './dto/project.dto';
import {
  type ProjectOptionDto,
  type ProjectProgressDto,
  type ProjectReportDto,
  type ProjectResponseDto,
  isTaskOverdue,
  toProjectResponse,
} from './dto/project.response';

/** ฟิลด์ที่ยอมให้เรียงลำดับได้ — กันค่าแปลกปลอมจาก query string sortBy หลุดเข้า ORDER BY */
const SORTABLE_FIELDS = new Set([
  'id',
  'code',
  'name',
  'status',
  'priority',
  'startDate',
  'targetEndDate',
  'contractValue',
  'createdAt',
  'updatedAt',
]);

/**
 * คอลัมน์ที่ไม่ได้อยู่ในตาราง projects — ชื่อ join มาจาก include ของรายการ (belongsTo ไม่แตก subquery)
 * `progress` เป็นอัตราส่วนงาน DONE ต่องานทั้งหมด สูตรเดียวกับ calculateProgressMany (ไม่มีงาน = 0)
 */
const JOINED_SORTS = new Map<string, (dir: string) => OrderItem>([
  ['customerName', (dir) => ['customer', 'name', dir]],
  ['managerName', (dir) => ['manager', 'fullName', dir]],
  [
    'progress',
    (dir) => [
      literal(
        "(SELECT COALESCE(SUM(t.status = 'DONE') / NULLIF(COUNT(*), 0), 0) FROM tasks t " +
          'WHERE t.project_id = `Project`.`id` AND t.deleted_at IS NULL)',
      ),
      dir,
    ],
  ],
]);

interface TaskProgressGroup {
  projectId: number;
  status: TaskStatus;
  dueDate: string | null;
  taskCount: number | string;
}

/** สร้างใหม่ทุกครั้ง — Sequelize แก้ object ของ include ในที่ตอน normalize ห้ามใช้ร่วมกัน */
function customerInclude() {
  return {
    model: Customer,
    attributes: ['id', 'name'],
    required: false,
    // ลูกค้าที่ถูก soft delete แล้วยังต้องเห็นชื่อได้ ไม่งั้นโครงการเก่าจะกลายเป็นไร้เจ้าของ
    paranoid: false,
  };
}

function managerInclude() {
  return {
    model: User,
    as: 'manager',
    attributes: ['id', 'username', 'fullName'],
    required: false,
    paranoid: false,
  };
}

@Injectable()
export class ProjectsService {
  constructor(
    @InjectModel(Project) private readonly projectModel: typeof Project,
    @InjectModel(Task) private readonly taskModel: typeof Task,
    @InjectModel(Customer) private readonly customerModel: typeof Customer,
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(Ticket) private readonly ticketModel: typeof Ticket,
    @InjectModel(Delivery) private readonly deliveryModel: typeof Delivery,
    @InjectModel(MaContract) private readonly maContractModel: typeof MaContract,
    private readonly customersService: CustomersService,
    private readonly accessControl: AccessControlService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async findAll(query: QueryProjectsDto): Promise<PaginatedResult<ProjectResponseDto>> {
    const where: WhereOptions<Project> = {};

    if (query.search) {
      const like = '%' + query.search + '%';
      Object.assign(where, {
        [Op.or]: [{ name: { [Op.like]: like } }, { code: { [Op.like]: like } }],
      });
    }

    if (query.status) {
      Object.assign(where, { status: query.status });
    }

    if (query.customerId !== undefined) {
      Object.assign(where, { customerId: query.customerId });
    }

    if (query.priority) {
      Object.assign(where, { priority: query.priority });
    }

    if (query.managerUserId !== undefined) {
      Object.assign(where, { managerUserId: query.managerUserId });
    }

    const sortKey = query.sortBy ?? '';
    const primaryOrder: OrderItem =
      JOINED_SORTS.get(sortKey)?.(query.sortOrder) ??
      (SORTABLE_FIELDS.has(sortKey) ? [sortKey, query.sortOrder] : ['createdAt', query.sortOrder]);

    const { rows, count } = await this.projectModel.findAndCountAll({
      where,
      include: [customerInclude(), managerInclude()],
      distinct: true,
      order: [primaryOrder, ['id', query.sortOrder]],
      limit: query.limit,
      offset: query.offset,
    });

    const progress = await this.calculateProgressMany(rows.map((project) => project.id));

    return toPaginatedResult(
      rows.map((project) => toProjectResponse(project, progress.get(project.id) ?? null)),
      count,
      query,
    );
  }

  async findOptions(query: QueryProjectOptionsDto = {}): Promise<ProjectOptionDto[]> {
    const like = query.search ? '%' + query.search + '%' : null;

    const projects = await this.projectModel.findAll({
      attributes: ['id', 'code', 'name', 'status'],
      ...(like && {
        where: { [Op.or]: [{ name: { [Op.like]: like } }, { code: { [Op.like]: like } }] },
      }),
      order: [
        ['name', 'ASC'],
        ['id', 'ASC'],
      ],
      ...(query.limit !== undefined && { limit: query.limit }),
    });

    return projects.map((project) => ({
      id: project.id,
      code: project.code,
      name: project.name,
      status: project.status,
    }));
  }

  async findOne(id: number): Promise<ProjectResponseDto> {
    const project = await this.projectModel.findByPk(id, {
      include: [customerInclude(), managerInclude()],
    });

    if (!project) {
      throw new NotFoundException('ไม่พบข้อมูลโครงการ');
    }

    return toProjectResponse(project, await this.calculateProgress(id));
  }

  /**
   * B-6 — สรุปตัวเลขสำหรับบล็อก「รายงานของโปรเจคนี้」
   *
   * ความคืบหน้าใช้สูตรเดียวกับ `GET /projects/:id` (`calculateProgress`)
   * จำนวนใบปัญหา / ส่งมอบ / สัญญา MA นับแถวที่ยังไม่ soft delete ของโปรเจคนี้
   */
  async getReport(id: number): Promise<ProjectReportDto> {
    await this.findOrFail(id);

    const [progress, ticketCount, deliveryCount, maContractCount] = await Promise.all([
      this.calculateProgress(id),
      this.ticketModel.count({ where: { projectId: id } }),
      this.deliveryModel.count({ where: { projectId: id } }),
      this.maContractModel.count({ where: { projectId: id } }),
    ]);

    return {
      projectId: id,
      progress,
      ticketCount,
      deliveryCount,
      maContractCount,
    };
  }

  async create(dto: CreateProjectDto, actor: AuthenticatedUser): Promise<ProjectResponseDto> {
    const actorId = getCurrentUserId();
    const { newCustomer } = dto;

    if (dto.customerId !== undefined && newCustomer) {
      throw new BadRequestException(
        'เลือกลูกค้าเดิมหรือกรอกลูกค้าใหม่อย่างใดอย่างหนึ่ง — ส่งมาทั้ง customerId และ newCustomer',
      );
    }

    if (dto.customerId !== undefined) {
      await this.assertCustomerExists(dto.customerId);
    } else if (newCustomer) {
      // project.create อย่างเดียวไม่พอ ไม่งั้นเส้นนี้เป็นทางอ้อมให้คนที่ไม่มีสิทธิ์เพิ่มลูกค้าได้
      if (!(await this.accessControl.hasPermission(actor, 'customer.create'))) {
        throw new ForbiddenException(
          'คุณไม่มีสิทธิ์เพิ่มลูกค้าใหม่ — เลือกลูกค้าที่มีอยู่แล้ว หรือให้ผู้มีสิทธิ์เพิ่มลูกค้าก่อน',
        );
      }
    } else {
      throw new BadRequestException('กรุณาเลือกลูกค้าเดิม หรือกรอกข้อมูลลูกค้าใหม่');
    }

    if (dto.managerUserId) {
      await this.assertManagerIsUsable(dto.managerUserId);
    }

    this.assertDateOrder(dto.startDate ?? null, dto.targetEndDate ?? null);

    const projectId = await this.sequelize.transaction(async (transaction) => {
      const customerId = newCustomer
        ? (await this.customersService.createRecord(newCustomer, actorId, transaction)).id
        : (dto.customerId as number);
      const code = await nextGeneratedCode(this.sequelize, 'PROJECT', transaction);

      const project = await this.projectModel.create(
        {
          customerId,
          name: dto.name,
          code,
          description: dto.description ?? null,
          projectType: dto.projectType ?? null,
          status: dto.status,
          priority: dto.priority,
          startDate: dto.startDate ?? null,
          targetEndDate: dto.targetEndDate ?? null,
          actualEndDate: dto.actualEndDate ?? null,
          contractValue: dto.contractValue ?? null,
          functionCount: dto.functionCount ?? null,
          managerUserId: dto.managerUserId ?? null,
          createdBy: actorId,
          updatedBy: actorId,
        },
        { transaction },
      );

      return project.id;
    });

    return this.findOne(projectId);
  }

  async update(id: number, dto: UpdateProjectDto): Promise<ProjectResponseDto> {
    const actorId = getCurrentUserId();
    const project = await this.findOrFail(id);

    if (dto.customerId !== undefined && dto.customerId !== project.customerId) {
      throw new BadRequestException(
        'ย้ายโครงการไปลูกค้ารายอื่นไม่ได้ ถ้าบันทึกผิดรายให้สร้างโครงการใหม่',
      );
    }

    if (dto.managerUserId) {
      await this.assertManagerIsUsable(dto.managerUserId);
    }

    this.assertDateOrder(
      dto.startDate !== undefined ? (dto.startDate ?? null) : project.startDate,
      dto.targetEndDate !== undefined ? (dto.targetEndDate ?? null) : project.targetEndDate,
    );

    await project.update({
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description ?? null } : {}),
      ...(dto.projectType !== undefined ? { projectType: dto.projectType ?? null } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
      ...(dto.startDate !== undefined ? { startDate: dto.startDate ?? null } : {}),
      ...(dto.targetEndDate !== undefined ? { targetEndDate: dto.targetEndDate ?? null } : {}),
      ...(dto.actualEndDate !== undefined ? { actualEndDate: dto.actualEndDate ?? null } : {}),
      ...(dto.contractValue !== undefined ? { contractValue: dto.contractValue ?? null } : {}),
      ...(dto.functionCount !== undefined ? { functionCount: dto.functionCount ?? null } : {}),
      ...(dto.managerUserId !== undefined ? { managerUserId: dto.managerUserId ?? null } : {}),
      updatedBy: actorId,
    });

    return this.findOne(id);
  }

  async findOrFail(id: number): Promise<Project> {
    const project = await this.projectModel.findByPk(id);

    if (!project) {
      throw new NotFoundException('ไม่พบข้อมูลโครงการ');
    }

    return project;
  }

  async calculateProgress(projectId: number): Promise<ProjectProgressDto> {
    const progress = await this.calculateProgressMany([projectId]);
    return progress.get(projectId) as ProjectProgressDto;
  }

  async calculateProgressMany(projectIds: number[]): Promise<Map<number, ProjectProgressDto>> {
    const counters = new Map(
      projectIds.map((id) => [
        id,
        {
          totalTasks: 0,
          overdueTasks: 0,
          byStatus: {
            [TaskStatus.TODO]: 0,
            [TaskStatus.DOING]: 0,
            [TaskStatus.WAITING]: 0,
            [TaskStatus.REVIEW]: 0,
            [TaskStatus.DONE]: 0,
          },
        },
      ]),
    );

    if (projectIds.length > 0) {
      const groups = (await this.taskModel.findAll({
        where: { projectId: { [Op.in]: projectIds } },
        attributes: ['projectId', 'status', 'dueDate', [fn('COUNT', col('id')), 'taskCount']],
        group: ['projectId', 'status', 'dueDate'],
        raw: true,
      })) as unknown as TaskProgressGroup[];

      for (const group of groups) {
        const counter = counters.get(group.projectId);

        if (!counter) {
          continue;
        }

        const count = Number(group.taskCount);
        counter.totalTasks += count;
        counter.byStatus[group.status] = (counter.byStatus[group.status] ?? 0) + count;

        if (isTaskOverdue(group)) {
          counter.overdueTasks += count;
        }
      }
    }

    const result = new Map<number, ProjectProgressDto>();

    for (const [id, { totalTasks, overdueTasks, byStatus }] of counters) {
      const doneTasks = byStatus[TaskStatus.DONE];
      const percent = totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100 * 100) / 100;
      result.set(id, { totalTasks, doneTasks, percent, overdueTasks, byStatus });
    }

    return result;
  }

  private async assertCustomerExists(customerId: number): Promise<void> {
    const customer = await this.customerModel.findByPk(customerId, { attributes: ['id'] });

    if (!customer) {
      throw new BadRequestException('ไม่พบข้อมูลลูกค้าที่ระบุ');
    }
  }

  private async assertCodeIsAvailable(code: string, excludeId?: number): Promise<void> {
    const where: WhereOptions<Project> = excludeId
      ? { code, id: { [Op.ne]: excludeId } }
      : { code };

    const existing = await this.projectModel.findOne({ where, paranoid: false });

    if (existing) {
      throw new ConflictException('รหัสโครงการนี้ถูกใช้ไปแล้ว');
    }
  }

  private async assertManagerIsUsable(managerUserId: number): Promise<void> {
    const manager = await this.userModel.findByPk(managerUserId, { attributes: ['id', 'status'] });

    if (!manager) {
      throw new BadRequestException('ไม่พบพนักงานที่ระบุเป็นผู้จัดการโครงการ');
    }

    if (manager.status !== UserStatus.ACTIVE) {
      throw new BadRequestException(
        'พนักงานที่ระบุไม่ได้อยู่ในสถานะใช้งาน จึงมอบหมายเป็นผู้จัดการโครงการไม่ได้',
      );
    }
  }

  private assertDateOrder(startDate: string | null, targetEndDate: string | null): void {
    if (startDate && targetEndDate && startDate > targetEndDate) {
      throw new BadRequestException('วันเริ่มโครงการต้องไม่อยู่หลังกำหนดส่งมอบ');
    }
  }
}
