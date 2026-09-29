/// <reference types="jest" />
// TypeScript 6 ไม่ดึง @types/jest เข้ามาให้อัตโนมัติ ต้องอ้างถึงตรงนี้เหมือน spec ตัวอื่น

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Op } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

import { runWithRequestContext } from '../../common/context/request-context';
import type { AccessControlService } from '../../common/services/access-control.service';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import {
  AccountType,
  Customer,
  CustomerStatus,
  Delivery,
  MaContract,
  Project,
  ProjectPriority,
  ProjectStatus,
  Task,
  TaskStatus,
  Ticket,
  User,
  UserStatus,
} from '../../models';
import type { CustomersService } from '../customers/customers.service';
import { ProjectsService } from './projects.service';
import { todayAsDateOnly } from './dto/project.response';

/**
 * เทสต์กฎธุรกิจของ Phase 5 ที่ CLAUDE.md 14 ระบุว่า "อย่าเขียนทับตอนต่อยอด"
 *
 * เน้นสูตรความคืบหน้าและข้อห้ามย้ายโครงการข้ามลูกค้า ซึ่งเป็นสองจุดที่พังเงียบได้
 * โดยที่ไม่มี error ให้เห็น — ตัวเลขแค่ผิด กับข้อมูลแค่ย้ายไปผิดที่
 */

interface ModelMock {
  findByPk: jest.Mock;
  findOne: jest.Mock;
  findAll: jest.Mock;
  findAndCountAll: jest.Mock;
  create: jest.Mock;
  count: jest.Mock;
}

function modelMock(): ModelMock {
  return {
    findByPk: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
    create: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
  };
}

function baseProjectRow() {
  return {
    id: 1,
    customerId: 1,
    customer: null,
    code: 'PRJ-2026-001' as string | null,
    name: 'ระบบจัดการคลังสินค้า',
    description: null as string | null,
    projectType: null as string | null,
    status: ProjectStatus.IN_PROGRESS,
    priority: ProjectPriority.NORMAL,
    startDate: null as string | null,
    targetEndDate: null as string | null,
    actualEndDate: null as string | null,
    contractValue: null as string | null,
    functionCount: null as number | null,
    managerUserId: null as number | null,
    manager: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    update: jest.fn(),
  };
}

type ProjectRow = ReturnType<typeof baseProjectRow>;

function projectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return { ...baseProjectRow(), ...overrides };
}

/** แถวที่ query รวมกลุ่มคืนมา (โครงการ, สถานะ, วันครบกำหนด, จำนวน) — ค่าเริ่มต้น 1 งานของโครงการ 1 */
function taskRow(status: TaskStatus, dueDate: string | null = null, taskCount = 1, projectId = 1) {
  return { projectId, status, dueDate, taskCount: String(taskCount) };
}

/** วันที่เมื่อวาน / พรุ่งนี้ ในรูปแบบ YYYY-MM-DD ตามเขตเวลาเครื่องเดียวกับ service */
function dateOnlyOffsetByDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** ผู้เรียกที่เป็น USER ธรรมดา — สิทธิ์จริงตัดสินโดย accessControl.hasPermission ที่ mock ไว้ */
const actor: AuthenticatedUser = { id: 7, username: 'pranee', accountType: AccountType.USER };

describe('ProjectsService', () => {
  let projectModel: ModelMock;
  let taskModel: ModelMock;
  let customerModel: ModelMock;
  let userModel: ModelMock;
  let ticketModel: ModelMock;
  let deliveryModel: ModelMock;
  let maContractModel: ModelMock;
  let customersService: { createRecord: jest.Mock };
  let accessControl: { hasPermission: jest.Mock };
  /** ของที่ส่งเข้า callback ของ transaction — ใช้ยืนยันว่าทุกการเขียนอยู่ในทรานแซกชันเดียวกัน */
  const fakeTransaction = { id: 'tx-1' };
  let service: ProjectsService;

  beforeEach(() => {
    projectModel = modelMock();
    taskModel = modelMock();
    customerModel = modelMock();
    userModel = modelMock();
    ticketModel = modelMock();
    deliveryModel = modelMock();
    maContractModel = modelMock();
    customersService = { createRecord: jest.fn().mockResolvedValue({ id: 55 }) };
    accessControl = { hasPermission: jest.fn().mockResolvedValue(true) };
    const sequelize = {
      transaction: jest.fn((work: (tx: unknown) => Promise<unknown>) => work(fakeTransaction)),
      query: jest.fn((sql: string) =>
        sql.includes('SELECT') ? Promise.resolve([{ nextValue: 1 }]) : Promise.resolve([]),
      ),
    };

    projectModel.findByPk.mockResolvedValue(projectRow());
    projectModel.findOne.mockResolvedValue(null);
    projectModel.create.mockResolvedValue(projectRow());
    taskModel.findAll.mockResolvedValue([]);
    customerModel.findByPk.mockResolvedValue({ id: 1 });
    userModel.findByPk.mockResolvedValue({ id: 3, status: UserStatus.ACTIVE });

    service = new ProjectsService(
      projectModel as unknown as typeof Project,
      taskModel as unknown as typeof Task,
      customerModel as unknown as typeof Customer,
      userModel as unknown as typeof User,
      ticketModel as unknown as typeof Ticket,
      deliveryModel as unknown as typeof Delivery,
      maContractModel as unknown as typeof MaContract,
      customersService as unknown as CustomersService,
      accessControl as unknown as AccessControlService,
      sequelize as unknown as Sequelize,
    );
  });

  // -------------------------------------------------------------------------
  // สูตรความคืบหน้า — (task ที่ DONE / task ทั้งหมด) x 100
  // -------------------------------------------------------------------------
  describe('calculateProgress', () => {
    it('คิดเป็นเปอร์เซ็นต์จากสัดส่วนงานที่เสร็จ', async () => {
      taskModel.findAll.mockResolvedValue([
        taskRow(TaskStatus.DONE),
        taskRow(TaskStatus.DONE),
        taskRow(TaskStatus.DONE),
        taskRow(TaskStatus.DOING),
      ]);

      const progress = await service.calculateProgress(1);

      expect(progress.totalTasks).toBe(4);
      expect(progress.doneTasks).toBe(3);
      expect(progress.percent).toBe(75);
    });

    it('โครงการที่ยังไม่มีงานเลยได้ 0% ไม่ใช่ 100%', async () => {
      // หารด้วยศูนย์แล้วปล่อยผ่านจะได้ NaN หรือ 100 ซึ่งทำให้หน้าจอโกหกว่าโครงการเสร็จแล้ว
      taskModel.findAll.mockResolvedValue([]);

      const progress = await service.calculateProgress(1);

      expect(progress.totalTasks).toBe(0);
      expect(progress.percent).toBe(0);
    });

    it('ปัดเปอร์เซ็นต์ที่หารไม่ลงตัวเหลือทศนิยม 2 ตำแหน่ง', async () => {
      taskModel.findAll.mockResolvedValue([
        taskRow(TaskStatus.DONE),
        taskRow(TaskStatus.TODO),
        taskRow(TaskStatus.TODO),
      ]);

      const progress = await service.calculateProgress(1);

      expect(progress.percent).toBe(33.33);
    });

    it('นับงานทุกชั้นแบบแบน ไม่แยกงานแม่งานย่อย', async () => {
      // เงื่อนไขต้องมีแค่ projectId ถ้าเผลอใส่ parentTaskId: null เข้าไป
      // งานย่อยจะหายจากตัวหาร ทำให้เปอร์เซ็นต์สูงเกินจริง
      let captured: Record<string, unknown> = {};
      taskModel.findAll.mockImplementation((options: { where: Record<string, unknown> }) => {
        captured = options.where;
        return Promise.resolve([]);
      });

      await service.calculateProgress(1);

      expect(captured).toEqual({ projectId: { [Op.in]: [1] } });
    });

    it('หลายโครงการใน query เดียว นับจำนวนจากกลุ่ม และโครงการที่ไม่มีงานได้ 0%', async () => {
      const yesterday = dateOnlyOffsetByDays(-1);
      taskModel.findAll.mockResolvedValue([
        taskRow(TaskStatus.DONE, null, 3, 1),
        taskRow(TaskStatus.DOING, yesterday, 2, 1),
        taskRow(TaskStatus.TODO, null, 4, 2),
      ]);

      const progress = await service.calculateProgressMany([1, 2, 3]);

      expect(taskModel.findAll).toHaveBeenCalledTimes(1);
      expect(progress.get(1)).toMatchObject({
        totalTasks: 5,
        doneTasks: 3,
        percent: 60,
        overdueTasks: 2,
      });
      expect(progress.get(2)).toMatchObject({ totalTasks: 4, doneTasks: 0, percent: 0 });
      expect(progress.get(3)).toMatchObject({ totalTasks: 0, percent: 0, overdueTasks: 0 });
    });

    it('รายการโครงการพ่วง progress มาทุกแถว ด้วย query งานครั้งเดียว', async () => {
      projectModel.findAndCountAll.mockResolvedValue({
        rows: [projectRow({ id: 1 }), projectRow({ id: 2 })],
        count: 2,
      });
      taskModel.findAll.mockResolvedValue([taskRow(TaskStatus.DONE, null, 1, 2)]);

      const result = await service.findAll({ page: 1, limit: 20, offset: 0 } as never);

      expect(taskModel.findAll).toHaveBeenCalledTimes(1);
      expect(result.items.map((item) => item.progress?.percent)).toEqual([0, 100]);
    });

    it('เรียงตามชื่อลูกค้า/ผู้จัดการผ่าน association และตัดสินรองด้วย id', async () => {
      projectModel.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
      const base = { page: 1, limit: 20, offset: 0, sortOrder: 'ASC' };

      await service.findAll({ ...base, sortBy: 'customerName' } as never);
      await service.findAll({ ...base, sortBy: 'managerName' } as never);
      await service.findAll({ ...base, sortBy: 'toString' } as never);

      const orders = projectModel.findAndCountAll.mock.calls.map(
        ([options]: [{ order: unknown[] }]) => options.order,
      );
      expect(orders[0]).toEqual([
        ['customer', 'name', 'ASC'],
        ['id', 'ASC'],
      ]);
      expect(orders[1]).toEqual([
        ['manager', 'fullName', 'ASC'],
        ['id', 'ASC'],
      ]);
      // ค่าที่ไม่รู้จัก (รวมชื่อ property ของ Object) ตกกลับไปใช้ค่าเริ่มต้น
      expect(orders[2]).toEqual([
        ['createdAt', 'ASC'],
        ['id', 'ASC'],
      ]);
    });

    it('แจกแจงจำนวนงานครบทุกสถานะ แม้สถานะที่ไม่มีงานเลย', async () => {
      taskModel.findAll.mockResolvedValue([taskRow(TaskStatus.DOING)]);

      const progress = await service.calculateProgress(1);

      expect(progress.byStatus).toEqual({
        [TaskStatus.TODO]: 0,
        [TaskStatus.DOING]: 1,
        [TaskStatus.WAITING]: 0,
        [TaskStatus.REVIEW]: 0,
        [TaskStatus.DONE]: 0,
      });
    });

    it('นับงานเกินกำหนดเฉพาะงานที่ยังไม่เสร็จ', async () => {
      const yesterday = dateOnlyOffsetByDays(-1);
      taskModel.findAll.mockResolvedValue([
        taskRow(TaskStatus.DOING, yesterday),
        // เลยกำหนดแต่ทำเสร็จแล้ว ไม่ควรถูกนับว่าค้าง
        taskRow(TaskStatus.DONE, yesterday),
      ]);

      const progress = await service.calculateProgress(1);

      expect(progress.overdueTasks).toBe(1);
    });

    it('งานที่ครบกำหนดวันนี้ยังไม่นับว่าเกิน', async () => {
      // ต้องให้เวลาทั้งวันทำงาน ไม่ใช่ขึ้นแดงตั้งแต่เที่ยงคืน
      taskModel.findAll.mockResolvedValue([taskRow(TaskStatus.DOING, todayAsDateOnly())]);

      const progress = await service.calculateProgress(1);

      expect(progress.overdueTasks).toBe(0);
    });

    it('งานที่ไม่ได้ตั้งวันครบกำหนดไม่มีทางเกินกำหนด', async () => {
      taskModel.findAll.mockResolvedValue([taskRow(TaskStatus.TODO, null)]);

      const progress = await service.calculateProgress(1);

      expect(progress.overdueTasks).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // B-6 — สรุปตัวเลขรายงานของโปรเจค
  // -------------------------------------------------------------------------
  describe('findOptions (ดรอปดาวน์)', () => {
    it('คืนทุกโครงการ ไม่แบ่งหน้า เรียงตามชื่อ มีแค่ id/code/name/status', async () => {
      projectModel.findAll.mockResolvedValue([
        { id: 2, code: 'PRJ-2026-002', name: 'ก', status: 'IN_PROGRESS', budget: 1 },
        { id: 7, code: null, name: 'ข', status: 'CLOSED' },
      ]);

      await expect(service.findOptions()).resolves.toEqual([
        { id: 2, code: 'PRJ-2026-002', name: 'ก', status: 'IN_PROGRESS' },
        { id: 7, code: null, name: 'ข', status: 'CLOSED' },
      ]);

      const [[options]] = projectModel.findAll.mock.calls as [[Record<string, unknown>]];
      expect(options.limit).toBeUndefined();
      expect(options.where).toBeUndefined();
      expect(options.order).toEqual([
        ['name', 'ASC'],
        ['id', 'ASC'],
      ]);
    });

    it('พิมพ์ค้น: กรองชื่อหรือรหัส และจำกัดจำนวนตาม limit', async () => {
      projectModel.findAll.mockResolvedValue([]);

      await service.findOptions({ search: 'คลัง', limit: 20 });

      const [[options]] = projectModel.findAll.mock.calls as [
        [{ where: Record<symbol, unknown>; limit: number }],
      ];
      expect(options.limit).toBe(20);
      expect(options.where[Op.or]).toEqual([
        { name: { [Op.like]: '%คลัง%' } },
        { code: { [Op.like]: '%คลัง%' } },
      ]);
    });
  });

  describe('getReport', () => {
    it('คืนความคืบหน้าและนับใบปัญหา ส่งมอบ สัญญา MA ของโปรเจค', async () => {
      taskModel.findAll.mockResolvedValue([
        taskRow(TaskStatus.DONE),
        taskRow(TaskStatus.DONE),
        taskRow(TaskStatus.DOING),
      ]);
      ticketModel.count.mockResolvedValue(4);
      deliveryModel.count.mockResolvedValue(2);
      maContractModel.count.mockResolvedValue(1);

      const report = await service.getReport(1);

      expect(report).toEqual({
        projectId: 1,
        progress: {
          totalTasks: 3,
          doneTasks: 2,
          percent: 66.67,
          overdueTasks: 0,
          byStatus: {
            TODO: 0,
            DOING: 1,
            WAITING: 0,
            REVIEW: 0,
            DONE: 2,
          },
        },
        ticketCount: 4,
        deliveryCount: 2,
        maContractCount: 1,
      });
      expect(ticketModel.count).toHaveBeenCalledWith({ where: { projectId: 1 } });
      expect(deliveryModel.count).toHaveBeenCalledWith({ where: { projectId: 1 } });
      expect(maContractModel.count).toHaveBeenCalledWith({ where: { projectId: 1 } });
    });

    it('โยน 404 เมื่อไม่พบโครงการ', async () => {
      projectModel.findByPk.mockResolvedValue(null);

      await expect(service.getReport(999)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // ย้ายโครงการข้ามลูกค้าไม่ได้
  // -------------------------------------------------------------------------
  describe('update', () => {
    it('ย้ายโครงการไปลูกค้ารายอื่นไม่ได้', async () => {
      // ticket และสัญญา MA ผูกกับลูกค้าเดิมไปแล้ว ถ้าย้ายได้ประวัติจะกระจัดกระจาย
      projectModel.findByPk.mockResolvedValue(projectRow({ customerId: 1 }));

      await expect(service.update(1, { customerId: 2 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('ส่ง customerId เดิมกลับมาได้ ไม่ถือว่าเป็นการย้าย', async () => {
      const project = projectRow({ customerId: 1 });
      projectModel.findByPk.mockResolvedValue(project);

      await service.update(1, { customerId: 1, name: 'ชื่อใหม่' });

      expect(project.update).toHaveBeenCalledTimes(1);
    });

    it('โยน 404 เมื่อไม่พบโครงการ', async () => {
      projectModel.findByPk.mockResolvedValue(null);

      await expect(service.update(999, { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('เทียบวันที่ที่ส่งมาใหม่กับค่าเดิมของโครงการ ไม่ใช่เทียบเฉพาะที่ส่งมาคู่กัน', async () => {
      // ส่งมาแค่ targetEndDate ตัวเดียว แต่ต้องยังชนกับ startDate เดิมที่อยู่ในฐานข้อมูล
      projectModel.findByPk.mockResolvedValue(projectRow({ startDate: '2026-12-01' }));

      await expect(service.update(1, { targetEndDate: '2026-01-01' })).rejects.toThrow(
        'วันเริ่มโครงการต้องไม่อยู่หลังกำหนดส่งมอบ',
      );
    });
  });

  // -------------------------------------------------------------------------
  // การตรวจก่อนสร้าง
  // -------------------------------------------------------------------------
  describe('create', () => {
    const dto = {
      customerId: 1,
      name: 'โครงการใหม่',
      status: ProjectStatus.DRAFT,
      priority: ProjectPriority.NORMAL,
    };

    it('สร้างให้ลูกค้าที่ไม่มีในระบบไม่ได้', async () => {
      customerModel.findByPk.mockResolvedValue(null);

      await expect(service.create(dto, actor)).rejects.toBeInstanceOf(BadRequestException);
      expect(projectModel.create).not.toHaveBeenCalled();
    });

    it('ตั้งพนักงานที่ลาออกแล้วเป็นผู้จัดการโครงการไม่ได้', async () => {
      userModel.findByPk.mockResolvedValue({ id: 3, status: UserStatus.RESIGNED });

      await expect(service.create({ ...dto, managerUserId: 3 }, actor)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('สร้างรหัสเองโดยไม่รับรหัสจาก client', async () => {
      projectModel.findOne.mockResolvedValue(projectRow());

      await expect(service.create({ ...dto, code: 'PRJ-2026-001' }, actor)).resolves.toBeDefined();
      expect(projectModel.findOne).not.toHaveBeenCalled();
    });

    it('ปฏิเสธวันเริ่มที่อยู่หลังกำหนดส่งมอบ', async () => {
      await expect(
        service.create({ ...dto, startDate: '2026-12-31', targetEndDate: '2026-01-01' }, actor),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('บันทึกผู้สร้างจาก request context ไม่ได้รับมาทางพารามิเตอร์', async () => {
      // ผู้กระทำมาจาก AsyncLocalStorage เส้นเดียวกับที่ audit hook ใช้ (BR-09)
      let captured: { createdBy: number | null; updatedBy: number | null } = {
        createdBy: null,
        updatedBy: null,
      };
      projectModel.create.mockImplementation(
        (values: { createdBy: number | null; updatedBy: number | null }) => {
          captured = values;
          return Promise.resolve(projectRow());
        },
      );

      await runWithRequestContext(
        { userId: 42, ipAddress: null, userAgent: null, startedAt: Date.now() },
        () => service.create(dto, actor),
      );

      expect(captured.createdBy).toBe(42);
      expect(captured.updatedBy).toBe(42);
    });
  });

  // -------------------------------------------------------------------------
  // สร้างโครงการพร้อมลูกค้าใหม่ในฟอร์มเดียว (ประชุม 11 ก.ย. — B-3)
  // -------------------------------------------------------------------------
  describe('create พร้อมลูกค้าใหม่', () => {
    const base = { name: 'โครงการของลูกค้าใหม่', status: ProjectStatus.DRAFT };
    const newCustomer = { name: 'บริษัท ลูกค้าใหม่ จำกัด', taxId: '0105561234567' };

    it('ลูกค้าใหม่กับโครงการถูกเขียนในทรานแซกชันเดียวกัน และโครงการได้ id ของลูกค้าใหม่', async () => {
      await runWithRequestContext(
        { userId: 7, ipAddress: null, userAgent: null, startedAt: Date.now() },
        () => service.create({ ...base, newCustomer }, actor),
      );

      expect(customersService.createRecord).toHaveBeenCalledWith(newCustomer, 7, fakeTransaction);
      expect(projectModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 55 }),
        { transaction: fakeTransaction },
      );
    });

    it('ไม่มีสิทธิ์ customer.create → 403 และไม่มีอะไรถูกเขียนเลย', async () => {
      // project.create อย่างเดียวไม่พอ ไม่งั้นเส้นนี้เป็นทางอ้อมให้เพิ่มลูกค้าได้
      accessControl.hasPermission.mockResolvedValue(false);

      await expect(service.create({ ...base, newCustomer }, actor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(accessControl.hasPermission).toHaveBeenCalledWith(actor, 'customer.create');
      expect(customersService.createRecord).not.toHaveBeenCalled();
      expect(projectModel.create).not.toHaveBeenCalled();
    });

    it('ส่งมาทั้ง customerId และ newCustomer → 400 ไม่เดาว่าจะเอาอันไหน', async () => {
      await expect(
        service.create({ ...base, customerId: 1, newCustomer }, actor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(customersService.createRecord).not.toHaveBeenCalled();
    });

    it('ไม่ส่งลูกค้ามาเลย → 400', async () => {
      await expect(service.create(base, actor)).rejects.toBeInstanceOf(BadRequestException);
      expect(projectModel.create).not.toHaveBeenCalled();
    });

    it('สร้างลูกค้าใหม่และโครงการได้โดยไม่รับรหัสจาก client', async () => {
      projectModel.findOne.mockResolvedValue(projectRow());

      await expect(
        service.create({ ...base, code: 'PRJ-2026-001', newCustomer }, actor),
      ).resolves.toBeDefined();
      expect(customersService.createRecord).toHaveBeenCalled();
    });

    it('ลูกค้าเดิม → ไม่สร้างลูกค้าและไม่ต้องเช็คสิทธิ์เพิ่มลูกค้า', async () => {
      await service.create({ ...base, customerId: 1 }, actor);

      expect(customersService.createRecord).not.toHaveBeenCalled();
      expect(accessControl.hasPermission).not.toHaveBeenCalled();
      expect(projectModel.create).toHaveBeenCalledWith(expect.objectContaining({ customerId: 1 }), {
        transaction: fakeTransaction,
      });
    });

    it('สถานะลูกค้าใหม่ไม่ได้ถูกตั้งที่นี่ — กติกา ACTIVE เป็นค่าเริ่มต้นอยู่ที่ CustomersService ที่เดียว', async () => {
      await service.create({ ...base, newCustomer }, actor);

      const [passed] = customersService.createRecord.mock.calls[0] as [{ status?: CustomerStatus }];
      expect(passed.status).toBeUndefined();
    });
  });
});
