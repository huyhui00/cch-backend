import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, type WhereOptions } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { getCurrentUserId } from '../../common/context/request-context';
import { type PaginatedResult, toPaginatedResult } from '../../common/dto/pagination.dto';
import { AccessControlService } from '../../common/services/access-control.service';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { Customer, Project, Task, TaskStatus, User, UserStatus } from '../../models';
import { CustomersService } from '../customers/customers.service';
import { CreateProjectDto, QueryProjectsDto, UpdateProjectDto } from './dto/project.dto';
import {
  type ProjectProgressDto,
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

    const sortBy = SORTABLE_FIELDS.has(query.sortBy ?? '') ? (query.sortBy as string) : 'createdAt';

    const { rows, count } = await this.projectModel.findAndCountAll({
      where,
      include: [customerInclude(), managerInclude()],
      distinct: true,
      order: [[sortBy, query.sortOrder]],
      limit: query.limit,
      offset: query.offset,
    });

    return toPaginatedResult(
      rows.map((project) => toProjectResponse(project)),
      count,
      query,
    );
  }

  /** รายละเอียดโครงการ พร้อมสรุปจำนวน task และเปอร์เซ็นต์ความคืบหน้า */
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
   * สร้างโครงการ — ลูกค้าเดิม (`customerId`) หรือลูกค้าใหม่ (`newCustomer`) อย่างใดอย่างหนึ่ง
   *
   * ลูกค้าใหม่ถูกบันทึกในทรานแซกชันเดียวกับโครงการ (ประชุม 11 ก.ย. — B-3) ถ้าขั้นใดพัง
   * จะไม่เหลือลูกค้าลอยอยู่ในระบบโดยไม่มีโครงการ ซึ่งผู้ใช้จะกดบันทึกซ้ำแล้วได้ลูกค้าซ้ำ
   * กติกาการสร้างลูกค้าใช้ของ `CustomersService.createRecord()` ตัวเดียวกับ `POST /api/customers`
   *
   * ตรวจทุกอย่างก่อนเปิดทรานแซกชัน — ของที่ปฏิเสธได้ต้องปฏิเสธก่อนเขียนอะไรลงฐานข้อมูล
   */
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

    if (dto.code) {
      await this.assertCodeIsAvailable(dto.code);
    }

    if (dto.managerUserId) {
      await this.assertManagerIsUsable(dto.managerUserId);
    }

    this.assertDateOrder(dto.startDate ?? null, dto.targetEndDate ?? null);

    const projectId = await this.sequelize.transaction(async (transaction) => {
      const customerId = newCustomer
        ? (await this.customersService.createRecord(newCustomer, actorId, transaction)).id
        : (dto.customerId as number);

      const project = await this.projectModel.create(
        {
          customerId,
          name: dto.name,
          code: dto.code ?? null,
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

    // ย้ายโครงการข้ามลูกค้าไม่ได้ — ticket และสัญญา MA ผูกกับลูกค้าเดิมไปแล้ว
    // ถ้าปล่อยให้ย้าย ประวัติจะกระจัดกระจายข้ามลูกค้าโดยไม่มีร่องรอย
    if (dto.customerId !== undefined && dto.customerId !== project.customerId) {
      throw new BadRequestException(
        'ย้ายโครงการไปลูกค้ารายอื่นไม่ได้ ถ้าบันทึกผิดรายให้สร้างโครงการใหม่',
      );
    }

    if (dto.code !== undefined && dto.code && dto.code !== project.code) {
      await this.assertCodeIsAvailable(dto.code, id);
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
      ...(dto.code !== undefined ? { code: dto.code ?? null } : {}),
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

  // ---- ใช้ร่วมกับ TasksService --------------------------------------------

  async findOrFail(id: number): Promise<Project> {
    const project = await this.projectModel.findByPk(id);

    if (!project) {
      throw new NotFoundException('ไม่พบข้อมูลโครงการ');
    }

    return project;
  }

  /**
   * ความคืบหน้า = (task ที่ DONE / task ทั้งหมด) x 100
   *
   * นับ task ทุกชั้นแบบแบน ทั้งงานแม่และงานย่อยมีน้ำหนักเท่ากัน ไม่ได้ถ่วงน้ำหนัก
   * ตามชั่วโมงที่ประเมินไว้ เพราะ estimated_hours เป็นค่าที่ไม่ได้กรอกกันทุกงาน
   * ถ้าถ่วงน้ำหนักแล้วบางงานไม่มีค่า ตัวเลขจะเพี้ยนโดยไม่มีใครรู้ตัว
   *
   * โครงการที่ยังไม่มี task เลยได้ 0% ไม่ใช่ 100% — หน้าจอดูจาก totalTasks
   * ประกอบได้ว่าเป็นเพราะยังไม่ได้แตกงาน ไม่ใช่เพราะยังไม่ได้ทำ
   */
  async calculateProgress(projectId: number): Promise<ProjectProgressDto> {
    const tasks = await this.taskModel.findAll({
      where: { projectId },
      attributes: ['status', 'dueDate'],
    });

    const byStatus: Record<string, number> = {
      [TaskStatus.TODO]: 0,
      [TaskStatus.DOING]: 0,
      [TaskStatus.WAITING]: 0,
      [TaskStatus.REVIEW]: 0,
      [TaskStatus.DONE]: 0,
    };

    let overdueTasks = 0;

    for (const task of tasks) {
      byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;

      if (isTaskOverdue(task)) {
        overdueTasks += 1;
      }
    }

    const totalTasks = tasks.length;
    const doneTasks = byStatus[TaskStatus.DONE];
    const percent = totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100 * 100) / 100;

    return { totalTasks, doneTasks, percent, overdueTasks, byStatus };
  }

  // ---- helpers -------------------------------------------------------------

  private async assertCustomerExists(customerId: number): Promise<void> {
    const customer = await this.customerModel.findByPk(customerId, { attributes: ['id'] });

    if (!customer) {
      throw new BadRequestException('ไม่พบข้อมูลลูกค้าที่ระบุ');
    }
  }

  /**
   * รหัสโครงการต้องไม่ซ้ำ — ตรวจรวมรายการที่ถูก soft delete ไปแล้วด้วย
   * เพราะ unique index ในฐานข้อมูลไม่สนใจ deleted_at
   */
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
