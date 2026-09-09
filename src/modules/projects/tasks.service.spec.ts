/// <reference types="jest" />
// TypeScript 6 ไม่ดึง @types/jest เข้ามาให้อัตโนมัติ ต้องอ้างถึงตรงนี้เหมือน spec ตัวอื่น

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Op } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

import { Task, TaskPriority, TaskStatus, User, UserStatus } from '../../models';
import { TasksService } from './tasks.service';
import type { ProjectsService } from './projects.service';
import { todayAsDateOnly } from './dto/project.response';

/**
 * เทสต์กฎธุรกิจของ Phase 5 ฝั่งงานย่อย (CLAUDE.md 14)
 *
 * สามจุดที่พังแล้วเจ็บที่สุด — completedAt ที่ไม่สอดคล้องกับสถานะ,
 * การเรียงลำดับที่เพี้ยนสะสมหลังลากไปมา, และการย้ายงานจนเกิดวงกลมจนไล่โครงสร้างวนไม่รู้จบ
 */

interface ModelMock {
  findByPk: jest.Mock;
  findAll: jest.Mock;
  findAndCountAll: jest.Mock;
  create: jest.Mock;
  count: jest.Mock;
}

function modelMock(): ModelMock {
  return {
    findByPk: jest.fn(),
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
  };
}

const TRANSACTION = { name: 'tx' };

function baseTaskRow() {
  return {
    id: 1,
    projectId: 1,
    parentTaskId: null as number | null,
    title: 'ออกแบบหน้าจอรับสินค้า',
    description: null as string | null,
    status: TaskStatus.TODO,
    priority: TaskPriority.NORMAL,
    assignedUserId: null as number | null,
    assignedUser: null,
    startDate: null as string | null,
    dueDate: null as string | null,
    completedAt: null as Date | null,
    estimatedHours: null as string | null,
    actualHours: null as string | null,
    sortOrder: 0,
    subTasks: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    update: jest.fn(),
    destroy: jest.fn(),
  };
}

type TaskRow = ReturnType<typeof baseTaskRow>;

function taskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return { ...baseTaskRow(), ...overrides };
}

describe('TasksService', () => {
  let taskModel: ModelMock;
  let userModel: ModelMock;
  let sequelize: { transaction: jest.Mock };
  let projectsService: { findOrFail: jest.Mock };
  let service: TasksService;

  /** ทะเบียนงานที่ findByPk จะหาเจอ — ใช้จำลองโครงสร้างงานแม่-งานย่อยหลายชั้น */
  let registry: Map<number, TaskRow>;

  beforeEach(() => {
    taskModel = modelMock();
    userModel = modelMock();
    registry = new Map();
    sequelize = {
      transaction: jest.fn((callback: (t: unknown) => Promise<unknown>) => callback(TRANSACTION)),
    };
    projectsService = { findOrFail: jest.fn().mockResolvedValue({ id: 1 }) };

    taskModel.findByPk.mockImplementation((id: number) =>
      Promise.resolve(registry.get(id) ?? null),
    );
    taskModel.findAll.mockResolvedValue([]);
    taskModel.count.mockResolvedValue(0);
    userModel.findByPk.mockResolvedValue({ id: 3, status: UserStatus.ACTIVE });

    service = new TasksService(
      taskModel as unknown as typeof Task,
      userModel as unknown as typeof User,
      sequelize as unknown as Sequelize,
      projectsService as unknown as ProjectsService,
    );
  });

  function register(...rows: TaskRow[]): void {
    for (const row of rows) {
      registry.set(row.id, row);
    }
  }

  // -------------------------------------------------------------------------
  // สถานะงานเปลี่ยนไปไหนก็ได้ แต่ completedAt ต้องสอดคล้องเสมอ
  // -------------------------------------------------------------------------
  describe('updateStatus', () => {
    it('บันทึกเวลาที่เสร็จให้เองเมื่อเปลี่ยนเป็น DONE', async () => {
      const task = taskRow({ status: TaskStatus.DOING, completedAt: null });
      let captured: { status: TaskStatus; completedAt: Date | null } = {
        status: TaskStatus.TODO,
        completedAt: null,
      };
      task.update.mockImplementation((values: { status: TaskStatus; completedAt: Date | null }) => {
        captured = values;
        return Promise.resolve(task);
      });
      register(task);

      await service.updateStatus(1, { status: TaskStatus.DONE });

      expect(captured.status).toBe(TaskStatus.DONE);
      expect(captured.completedAt).toBeInstanceOf(Date);
    });

    it('ไม่ทับเวลาเดิมเมื่อสั่งเป็น DONE ซ้ำ', async () => {
      // ไม่งั้นการกดซ้ำโดยไม่ตั้งใจจะทำให้ไม่รู้ว่างานเสร็จจริงเมื่อไร
      const finishedAt = new Date('2026-03-01T00:00:00Z');
      const task = taskRow({ status: TaskStatus.DONE, completedAt: finishedAt });
      register(task);

      await service.updateStatus(1, { status: TaskStatus.DONE });

      expect(task.update).toHaveBeenCalledWith(
        expect.objectContaining({ completedAt: finishedAt }),
      );
    });

    it('ล้างเวลาที่เสร็จเมื่อถอยออกจาก DONE', async () => {
      // งานที่ตรวจแล้วไม่ผ่านต้องไม่เหลือเวลาเสร็จค้างไว้ ไม่งั้นรายงานจะนับผิด
      const task = taskRow({ status: TaskStatus.DONE, completedAt: new Date() });
      register(task);

      await service.updateStatus(1, { status: TaskStatus.DOING });

      expect(task.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: TaskStatus.DOING, completedAt: null }),
      );
    });

    it('ถอยสถานะกลับได้ ไม่บังคับลำดับ', async () => {
      // งานจริงถอยได้ เช่น REVIEW ไม่ผ่านต้องกลับไป DOING
      // ถ้าบังคับลำดับ ผู้ใช้จะเลี่ยงด้วยการสร้างงานใหม่ ซึ่งทำให้ประวัติขาด
      const task = taskRow({ status: TaskStatus.REVIEW });
      register(task);

      await expect(service.updateStatus(1, { status: TaskStatus.TODO })).resolves.toBeDefined();
    });

    it('โยน 404 เมื่อไม่พบงาน', async () => {
      await expect(service.updateStatus(999, { status: TaskStatus.DONE })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // จัดลำดับ — เรียงพี่น้องทั้งกลุ่มใหม่เป็น 0, 1, 2, ...
  // -------------------------------------------------------------------------
  describe('updateOrder', () => {
    function siblings() {
      const first = taskRow({ id: 1, sortOrder: 0, title: 'งานที่หนึ่ง' });
      const second = taskRow({ id: 2, sortOrder: 1, title: 'งานที่สอง' });
      const third = taskRow({ id: 3, sortOrder: 2, title: 'งานที่สาม' });
      register(first, second, third);
      taskModel.findAll.mockResolvedValue([first, second, third]);
      return { first, second, third };
    }

    it('เขียนลำดับใหม่ให้ทุกตัวในกลุ่มที่ตำแหน่งเปลี่ยน', async () => {
      // แก้เฉพาะตัวที่ลากจะทำให้ค่าชนกันจนลำดับเพี้ยนหลังลากไปมาหลายรอบ
      const { first, second, third } = siblings();

      await service.updateOrder(3, { sortOrder: 0 });

      expect(third.update).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 0 }), {
        transaction: TRANSACTION,
      });
      expect(first.update).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 1 }), {
        transaction: TRANSACTION,
      });
      expect(second.update).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 2 }), {
        transaction: TRANSACTION,
      });
    });

    it('ไม่เขียนอะไรเลยเมื่อลากแล้ววางที่เดิม', async () => {
      const { first, second, third } = siblings();

      await service.updateOrder(3, { sortOrder: 2 });

      expect(first.update).not.toHaveBeenCalled();
      expect(second.update).not.toHaveBeenCalled();
      expect(third.update).not.toHaveBeenCalled();
    });

    it('ตำแหน่งที่เกินจำนวนพี่น้องถูกหนีบให้ไปอยู่ท้ายสุด', async () => {
      const { first, third } = siblings();

      await service.updateOrder(1, { sortOrder: 99 });

      expect(first.update).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 2 }), {
        transaction: TRANSACTION,
      });
      expect(third.update).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 1 }), {
        transaction: TRANSACTION,
      });
    });

    it('จัดลำดับทั้งกลุ่มอยู่ในทรานแซกชันเดียว', async () => {
      siblings();

      await service.updateOrder(3, { sortOrder: 0 });

      expect(sequelize.transaction).toHaveBeenCalledTimes(1);
    });

    it('เรียงเฉพาะพี่น้องใต้งานแม่เดียวกันในโครงการเดียวกัน', async () => {
      const child = taskRow({ id: 5, projectId: 1, parentTaskId: 2, sortOrder: 0 });
      register(child);
      let captured: { projectId: number; parentTaskId: number | null } = {
        projectId: 0,
        parentTaskId: null,
      };
      taskModel.findAll.mockImplementation(
        (options: { where: { projectId: number; parentTaskId: number | null } }) => {
          captured = options.where;
          return Promise.resolve([child]);
        },
      );

      await service.updateOrder(5, { sortOrder: 0 });

      expect(captured).toEqual({ projectId: 1, parentTaskId: 2 });
    });
  });

  // -------------------------------------------------------------------------
  // ย้ายงานแม่ — ห้ามข้ามโครงการ และห้ามเกิดวงกลม
  // -------------------------------------------------------------------------
  describe('การย้ายงานไปอยู่ใต้งานแม่', () => {
    it('งานแม่ต้องอยู่ในโครงการเดียวกัน', async () => {
      const task = taskRow({ id: 1, projectId: 1 });
      const foreignParent = taskRow({ id: 2, projectId: 99 });
      register(task, foreignParent);

      await expect(service.update(1, 1, { parentTaskId: 2 })).rejects.toThrow(
        'งานแม่ต้องอยู่ในโครงการเดียวกัน',
      );
    });

    it('ระบุงานแม่ที่ไม่มีในระบบไม่ได้', async () => {
      register(taskRow({ id: 1 }));

      await expect(service.update(1, 1, { parentTaskId: 999 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('ตั้งงานให้เป็นงานแม่ของตัวเองไม่ได้', async () => {
      register(taskRow({ id: 1 }));

      await expect(service.update(1, 1, { parentTaskId: 1 })).rejects.toThrow(
        'ตั้งให้งานเป็นงานแม่ของตัวเองไม่ได้',
      );
    });

    it('ย้ายงานไปอยู่ใต้งานย่อยของตัวเองไม่ได้', async () => {
      // 1 -> 2 -> 3 แล้วสั่งให้ 1 ไปอยู่ใต้ 3 จะเกิดวงกลมที่ไล่โครงสร้างวนไม่รู้จบ
      const grandparent = taskRow({ id: 1, parentTaskId: null });
      const parent = taskRow({ id: 2, parentTaskId: 1 });
      const child = taskRow({ id: 3, parentTaskId: 2 });
      register(grandparent, parent, child);

      await expect(service.update(1, 1, { parentTaskId: 3 })).rejects.toThrow(
        'ย้ายงานไปอยู่ใต้งานย่อยของตัวเองไม่ได้',
      );
    });

    it('ย้ายไปอยู่ใต้งานอื่นที่ไม่ได้เกี่ยวข้องกันได้ตามปกติ', async () => {
      const task = taskRow({ id: 1, parentTaskId: null });
      const unrelated = taskRow({ id: 2, parentTaskId: null });
      register(task, unrelated);

      await service.update(1, 1, { parentTaskId: 2 });

      expect(task.update).toHaveBeenCalledWith(expect.objectContaining({ parentTaskId: 2 }));
    });

    it('ถอดงานออกมาเป็นงานระดับบนสุดได้โดยไม่ต้องตรวจวงกลม', async () => {
      const task = taskRow({ id: 1, parentTaskId: 2 });
      register(task);

      await service.update(1, 1, { parentTaskId: null });

      expect(task.update).toHaveBeenCalledWith(expect.objectContaining({ parentTaskId: null }));
    });
  });

  // -------------------------------------------------------------------------
  // กันการแก้งานของโครงการอื่นผ่าน URL ของโครงการนี้
  // -------------------------------------------------------------------------
  it('แก้งานของโครงการอื่นผ่าน URL ของโครงการนี้ไม่ได้', async () => {
    register(taskRow({ id: 1, projectId: 99 }));

    await expect(service.update(1, 1, { title: 'เปลี่ยนชื่อ' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // -------------------------------------------------------------------------
  // งานเกินกำหนด
  // -------------------------------------------------------------------------
  describe('findOverdue', () => {
    it('เอาเฉพาะงานที่เลยวันครบกำหนดและยังไม่เสร็จ', async () => {
      let captured: {
        dueDate: Record<symbol, string>;
        status: Record<symbol, TaskStatus>;
      } = { dueDate: {}, status: {} };
      taskModel.findAndCountAll.mockImplementation(
        (options: {
          where: { dueDate: Record<symbol, string>; status: Record<symbol, TaskStatus> };
        }) => {
          captured = options.where;
          return Promise.resolve({ rows: [], count: 0 });
        },
      );

      await service.findOverdue({ page: 1, limit: 20, offset: 0 } as never);

      // เทียบเป็นวัน ไม่ใช่เวลา — งานที่ครบกำหนดวันนี้ยังไม่นับว่าเกิน
      expect(captured.dueDate[Op.lt]).toBe(todayAsDateOnly());
      expect(captured.status[Op.ne]).toBe(TaskStatus.DONE);
    });
  });

  // -------------------------------------------------------------------------
  // ลบงานแม่แล้วงานย่อยทุกชั้นถูกลบตาม
  // -------------------------------------------------------------------------
  describe('remove', () => {
    it('ลบงานย่อยทุกชั้นตามไปด้วยในทรานแซกชันเดียว', async () => {
      const parent = taskRow({ id: 1, projectId: 1 });
      const child = taskRow({ id: 2, projectId: 1, parentTaskId: 1 });
      const grandchild = taskRow({ id: 3, projectId: 1, parentTaskId: 2 });
      register(parent, child, grandchild);

      const childrenOf: Record<number, TaskRow[]> = { 1: [child], 2: [grandchild], 3: [] };
      taskModel.findAll.mockImplementation((options: { where: { parentTaskId: number } }) =>
        Promise.resolve(childrenOf[options.where.parentTaskId] ?? []),
      );

      await service.remove(1, 1);

      expect(grandchild.destroy).toHaveBeenCalledWith({ transaction: TRANSACTION });
      expect(child.destroy).toHaveBeenCalledWith({ transaction: TRANSACTION });
      expect(parent.destroy).toHaveBeenCalledWith({ transaction: TRANSACTION });
      expect(sequelize.transaction).toHaveBeenCalledTimes(1);
    });

    it('ลบงานของโครงการอื่นผ่าน URL ของโครงการนี้ไม่ได้', async () => {
      register(taskRow({ id: 1, projectId: 99 }));

      await expect(service.remove(1, 1)).rejects.toBeInstanceOf(NotFoundException);
      expect(sequelize.transaction).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // การสร้างงานใหม่
  // -------------------------------------------------------------------------
  describe('create', () => {
    const dto = { title: 'งานใหม่', priority: TaskPriority.NORMAL };

    beforeEach(() => {
      taskModel.create.mockImplementation((values: { id?: number }) => {
        const row = taskRow({ ...values, id: 10 });
        register(row);
        return Promise.resolve(row);
      });
    });

    it('ต่อท้ายกลุ่มพี่น้องอัตโนมัติเมื่อไม่ได้ระบุลำดับมา', async () => {
      taskModel.count.mockResolvedValue(3);

      let captured: { sortOrder: number } = { sortOrder: -1 };
      taskModel.create.mockImplementation((values: { sortOrder: number }) => {
        captured = values;
        const row = taskRow({ id: 10 });
        register(row);
        return Promise.resolve(row);
      });

      await service.create(1, dto);

      expect(captured.sortOrder).toBe(3);
    });

    it('สร้างเป็น DONE เลยได้ พร้อมบันทึกเวลาที่เสร็จให้ทันที', async () => {
      // ใช้ตอนคีย์งานที่ทำเสร็จไปแล้วย้อนหลัง ซึ่งเป็นเรื่องปกติของบริษัทที่เพิ่งเริ่มใช้ระบบ
      let captured: { completedAt: Date | null } = { completedAt: null };
      taskModel.create.mockImplementation((values: { completedAt: Date | null }) => {
        captured = values;
        const row = taskRow({ id: 10 });
        register(row);
        return Promise.resolve(row);
      });

      await service.create(1, { ...dto, status: TaskStatus.DONE });

      expect(captured.completedAt).toBeInstanceOf(Date);
    });

    it('มอบหมายงานให้พนักงานที่ลาออกแล้วไม่ได้', async () => {
      userModel.findByPk.mockResolvedValue({ id: 3, status: UserStatus.RESIGNED });

      await expect(service.create(1, { ...dto, assignedUserId: 3 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(taskModel.create).not.toHaveBeenCalled();
    });

    it('ปฏิเสธวันเริ่มงานที่อยู่หลังวันครบกำหนด', async () => {
      await expect(
        service.create(1, { ...dto, startDate: '2026-12-31', dueDate: '2026-01-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
