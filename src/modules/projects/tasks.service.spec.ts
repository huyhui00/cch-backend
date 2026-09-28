/// <reference types="jest" />
// TypeScript 6 ไม่ดึง @types/jest เข้ามาให้อัตโนมัติ ต้องอ้างถึงตรงนี้เหมือน spec ตัวอื่น

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Op } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

import {
  Document,
  Task,
  TaskPriority,
  TaskStatus,
  TaskSubmission,
  User,
  UserStatus,
} from '../../models';
import { TasksService } from './tasks.service';
import type { ProjectsService } from './projects.service';
import { addDays } from '../../common/utils/date.util';
import { runWithRequestContext } from '../../common/context/request-context';
import { todayAsDateOnly } from './dto/project.response';

/**
 * เทสต์กฎธุรกิจของ Phase 5 ฝั่งงานย่อย (CLAUDE.md 14)
 *
 * สามจุดที่พังแล้วเจ็บที่สุด — completedAt ที่ไม่สอดคล้องกับสถานะ,
 * การเรียงลำดับที่เพี้ยนสะสมหลังลากไปมา, และการย้ายงานจนเกิดวงกลมจนไล่โครงสร้างวนไม่รู้จบ
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
    assignedByUserId: null as number | null,
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
  let submissionModel: ModelMock;
  let projectModel: ModelMock;
  let documentModel: ModelMock;
  let userModel: ModelMock;
  let sequelize: { transaction: jest.Mock };
  let projectsService: { findOrFail: jest.Mock };
  let accessControl: { hasPermission: jest.Mock };
  let storage: { put: jest.Mock; get: jest.Mock };
  let service: TasksService;

  /** ทะเบียนงานที่ findByPk จะหาเจอ — ใช้จำลองโครงสร้างงานแม่-งานย่อยหลายชั้น */
  let registry: Map<number, TaskRow>;

  beforeEach(() => {
    taskModel = modelMock();
    submissionModel = modelMock();
    projectModel = modelMock();
    documentModel = modelMock();
    userModel = modelMock();
    registry = new Map();
    sequelize = {
      transaction: jest.fn((callback: (t: unknown) => Promise<unknown>) => callback(TRANSACTION)),
    };
    projectsService = { findOrFail: jest.fn().mockResolvedValue({ id: 1 }) };
    accessControl = { hasPermission: jest.fn().mockResolvedValue(true) };
    storage = { put: jest.fn(), get: jest.fn() };

    taskModel.findByPk.mockImplementation((id: number) =>
      Promise.resolve(registry.get(id) ?? null),
    );
    taskModel.findAll.mockResolvedValue([]);
    taskModel.count.mockResolvedValue(0);
    userModel.findByPk.mockResolvedValue({ id: 3, status: UserStatus.ACTIVE });
    projectModel.findByPk.mockResolvedValue({ id: 1, managerUserId: null });
    submissionModel.findOne.mockResolvedValue({ update: jest.fn() });

    service = new TasksService(
      taskModel as unknown as typeof Task,
      submissionModel as unknown as typeof TaskSubmission,
      projectModel as never,
      documentModel as unknown as typeof Document,
      userModel as unknown as typeof User,
      sequelize as unknown as Sequelize,
      projectsService as unknown as ProjectsService,
      accessControl as never,
      storage as never,
    );
  });

  function register(...rows: TaskRow[]): void {
    for (const row of rows) {
      registry.set(row.id, row);
    }
  }

  describe('findMyTasks', () => {
    it('กรองด้วย user id จากฝั่ง server และคืนผลแบบแบ่งหน้า', async () => {
      const task = taskRow({ assignedUserId: 42 });
      let captured: { assignedUserId: number } | undefined;
      taskModel.findAndCountAll.mockImplementation((options: { where: typeof captured }) => {
        captured = options.where;
        return Promise.resolve({ rows: [task], count: 1 });
      });

      const result = await service.findMyTasks(42, {
        page: 1,
        limit: 20,
        offset: 0,
      } as never);

      expect(captured).toEqual(
        expect.objectContaining({
          assignedUserId: 42,
          status: { [Op.notIn]: [TaskStatus.REVIEW, TaskStatus.DONE] },
        }),
      );
      expect(result).toMatchObject({ total: 1, page: 1, limit: 20 });
    });
  });

  // -------------------------------------------------------------------------
  // สถานะงานเปลี่ยนไปไหนก็ได้ แต่ completedAt ต้องสอดคล้องเสมอ
  // -------------------------------------------------------------------------
  describe('updateStatus', () => {
    it('บันทึกเวลาที่เสร็จให้เองเมื่อเปลี่ยนเป็น DONE', async () => {
      const task = taskRow({
        status: TaskStatus.REVIEW,
        assignedUserId: 2,
        assignedByUserId: 9,
        completedAt: null,
      });
      let captured: { status: TaskStatus; completedAt: Date | null } = {
        status: TaskStatus.TODO,
        completedAt: null,
      };
      task.update.mockImplementation((values: { status: TaskStatus; completedAt: Date | null }) => {
        captured = values;
        return Promise.resolve(task);
      });
      register(task);

      await runWithRequestContext(
        { userId: 9, ipAddress: null, userAgent: null, startedAt: Date.now() },
        () => service.review(1, { status: TaskStatus.DONE }),
      );

      expect(captured.status).toBe(TaskStatus.DONE);
      expect(captured.completedAt).toBeInstanceOf(Date);
    });

    it('ไม่ทับเวลาเดิมเมื่อสั่งเป็น DONE ซ้ำ', async () => {
      // ไม่งั้นการกดซ้ำโดยไม่ตั้งใจจะทำให้ไม่รู้ว่างานเสร็จจริงเมื่อไร
      const finishedAt = new Date('2026-03-01T00:00:00Z');
      const task = taskRow({
        status: TaskStatus.REVIEW,
        assignedUserId: 2,
        assignedByUserId: 9,
        completedAt: finishedAt,
      });
      register(task);

      await runWithRequestContext(
        { userId: 9, ipAddress: null, userAgent: null, startedAt: Date.now() },
        () => service.review(1, { status: TaskStatus.DONE }),
      );

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
      const task = taskRow({ status: TaskStatus.REVIEW, assignedUserId: 2 });
      register(task);

      await expect(
        runWithRequestContext(
          { userId: 9, ipAddress: null, userAgent: null, startedAt: Date.now() },
          () => service.updateStatus(1, { status: TaskStatus.TODO }),
        ),
      ).resolves.toBeDefined();
    });

    it('โยน 404 เมื่อไม่พบงาน', async () => {
      await expect(service.updateStatus(999, { status: TaskStatus.DONE })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('workflow ส่งตรวจ', () => {
    it('ผู้รับผิดชอบส่งงานตรวจได้', async () => {
      const task = taskRow({ status: TaskStatus.DOING, assignedUserId: 7 });
      register(task);

      await runWithRequestContext(
        { userId: 7, ipAddress: null, userAgent: null, startedAt: Date.now() },
        () => service.submitForReview(1),
      );

      expect(task.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: TaskStatus.REVIEW, completedAt: null, updatedBy: 7 }),
      );
    });

    it('ผู้ที่ไม่ใช่ผู้รับผิดชอบส่งงานแทนไม่ได้', async () => {
      const task = taskRow({ status: TaskStatus.DOING, assignedUserId: 7 });
      register(task);

      await expect(
        runWithRequestContext(
          { userId: 8, ipAddress: null, userAgent: null, startedAt: Date.now() },
          () => service.submitForReview(1),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('ห้ามปิดงานจากสถานะอื่นโดยข้ามการตรวจ', async () => {
      const task = taskRow({ status: TaskStatus.DOING, assignedUserId: 7 });
      register(task);

      await expect(
        runWithRequestContext(
          { userId: 8, ipAddress: null, userAgent: null, startedAt: Date.now() },
          () => service.updateStatus(1, { status: TaskStatus.DONE }),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('ผู้ตรวจอนุมัติได้ แต่ผู้รับผิดชอบอนุมัติงานตัวเองไม่ได้', async () => {
      const task = taskRow({ status: TaskStatus.REVIEW, assignedUserId: 7, assignedByUserId: 8 });
      register(task);

      await expect(
        runWithRequestContext(
          { userId: 7, ipAddress: null, userAgent: null, startedAt: Date.now() },
          () => service.review(1, { status: TaskStatus.DONE }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      await runWithRequestContext(
        { userId: 8, ipAddress: null, userAgent: null, startedAt: Date.now() },
        () => service.review(1, { status: TaskStatus.DONE }),
      );

      expect(task.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: TaskStatus.DONE, updatedBy: 8 }),
      );
    });

    it('เมื่ออนุมัติแล้วให้ย้ายไฟล์ที่ส่งมาจาก submission เข้าเอกสารของโปรเจค', async () => {
      const task = taskRow({
        id: 1,
        status: TaskStatus.REVIEW,
        assignedUserId: 7,
        assignedByUserId: 8,
        projectId: 15,
        title: 'ติดตั้งระบบ CRM',
      });
      const submission = {
        id: 21,
        taskId: 1,
        status: 'PENDING',
        fileUrl: 'tasks/1/submissions/abc.pdf',
        fileName: 'abc.pdf',
        fileSize: 2048,
        mimeType: 'application/pdf',
        report: 'รายงานเสร็จแล้ว',
        update: jest.fn().mockResolvedValue(true),
      };
      const project = { id: 15, customerId: 88 };

      register(task);
      submissionModel.findOne.mockResolvedValue(submission);
      projectModel.findByPk.mockResolvedValue(project);
      documentModel.create.mockResolvedValue({ id: 99 });

      await runWithRequestContext(
        { userId: 8, ipAddress: null, userAgent: null, startedAt: Date.now() },
        () => service.review(1, { status: TaskStatus.DONE, reviewNote: 'อนุมัติแล้ว' }),
      );

      expect(documentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 15,
          customerId: 88,
          title: 'abc.pdf',
          fileUrl: 'tasks/1/submissions/abc.pdf',
          fileName: 'abc.pdf',
          fileSize: 2048,
          mimeType: 'application/pdf',
          note: expect.stringContaining('ติดตั้งระบบ CRM'),
          createdBy: 8,
          updatedBy: 8,
        }),
      );
    });

    it('ส่งกลับแก้พร้อมไฟล์ของผู้ตรวจ — ไฟล์เก็บที่รายงานรอบนั้น ไม่ย้ายเข้าเอกสารโปรเจค', async () => {
      const task = taskRow({ status: TaskStatus.REVIEW, assignedUserId: 7, assignedByUserId: 8 });
      const submission = { id: 21, status: 'PENDING', fileUrl: null, update: jest.fn() };
      register(task);
      submissionModel.findOne.mockResolvedValue(submission);
      storage.put.mockResolvedValue({ key: 'local:tasks/1/reviews/x.png' });

      await runWithRequestContext(
        { userId: 8, ipAddress: null, userAgent: null, startedAt: Date.now() },
        () =>
          service.review(
            1,
            { status: TaskStatus.DOING, reviewNote: 'ปุ่มบันทึกไม่ทำงาน' },
            {
              originalname: 'จุดที่ต้องแก้.png',
              buffer: Buffer.from('x'),
              mimetype: 'image/png',
              size: 1,
            },
          ),
      );

      expect(storage.put).toHaveBeenCalledWith(
        expect.stringContaining('tasks/1/reviews/'),
        expect.anything(),
        'image/png',
      );
      expect(submission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'REJECTED',
          reviewNote: 'ปุ่มบันทึกไม่ทำงาน',
          reviewFileUrl: 'local:tasks/1/reviews/x.png',
          reviewFileName: 'จุดที่ต้องแก้.png',
          reviewMimeType: 'image/png',
        }),
      );
      expect(documentModel.create).not.toHaveBeenCalled();
    });

    it('ไฟล์ของผู้ตรวจผิดประเภท = 400 และงานยังไม่ถูกเปลี่ยนสถานะ', async () => {
      const task = taskRow({ status: TaskStatus.REVIEW, assignedUserId: 7, assignedByUserId: 8 });
      register(task);

      await expect(
        runWithRequestContext(
          { userId: 8, ipAddress: null, userAgent: null, startedAt: Date.now() },
          () =>
            service.review(
              1,
              { status: TaskStatus.DOING },
              {
                originalname: 'virus.exe',
                buffer: Buffer.from('x'),
                mimetype: 'application/octet-stream',
                size: 1,
              },
            ),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(task.update).not.toHaveBeenCalled();
    });

    it('ดาวน์โหลดไฟล์ผู้ตรวจที่ไม่มี = 404', async () => {
      submissionModel.findByPk.mockResolvedValue({ id: 21, reviewFileUrl: null });

      await expect(service.openReviewFile(21)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findReviews (เมนูงานตรวจ)', () => {
    const admin = { id: 1, accountType: 'ADMIN' } as never;
    const reviewer = { id: 8, accountType: 'USER' } as never;

    function captureSubmissionQuery() {
      const captured: { where?: Record<string | symbol, unknown>; order?: unknown[] } = {};
      submissionModel.findAndCountAll.mockImplementation(
        (options: { where: Record<string | symbol, unknown>; order: unknown[] }) => {
          captured.where = options.where;
          captured.order = options.order;
          return Promise.resolve({ rows: [], count: 0 });
        },
      );
      return captured;
    }

    it('แท็บ REVIEWED = รายงานที่ฉันตรวจเท่านั้น แม้เป็น ADMIN และเรียงล่าสุดก่อน', async () => {
      const captured = captureSubmissionQuery();

      await service.findReviews({ tab: 'REVIEWED', page: 1, limit: 20, offset: 0 } as never, admin);

      expect(captured.where?.reviewedByUserId).toBe(1);
      expect(captured.order?.[0]).toEqual(['reviewedAt', 'DESC']);
    });

    it('แท็บ REVIEWED กรองผลตรวจได้', async () => {
      const captured = captureSubmissionQuery();

      await service.findReviews(
        { tab: 'REVIEWED', result: 'REJECTED', page: 1, limit: 20, offset: 0 } as never,
        admin,
      );

      expect(captured.where?.status).toBe('REJECTED');
    });

    it('แท็บ PENDING ของ USER จำกัดเฉพาะงานที่ตัวเองมอบหมายหรือเป็นผู้จัดการโครงการ', async () => {
      const captured = captureSubmissionQuery();
      projectModel.findAll.mockResolvedValue([{ id: 15 }]);
      let taskWhere: Record<string | symbol, unknown> = {};
      taskModel.findAll.mockImplementation(
        (options: { where: Record<string | symbol, unknown> }) => {
          taskWhere = options.where;
          return Promise.resolve([{ id: 3 }]);
        },
      );

      await service.findReviews(
        { tab: 'PENDING', page: 1, limit: 20, offset: 0 } as never,
        reviewer,
      );

      expect(taskWhere.status).toBe(TaskStatus.REVIEW);
      expect(taskWhere[Op.and]).toEqual([
        { [Op.or]: [{ assignedByUserId: 8 }, { projectId: { [Op.in]: [15] } }] },
      ]);
      expect(captured.where?.status).toBe('PENDING');
      expect(captured.where?.taskId).toEqual({ [Op.in]: [3] });
    });

    it('search ค้นชื่องาน + รหัส/ชื่อโครงการ และไม่ทับขอบเขตผู้ตรวจ', async () => {
      captureSubmissionQuery();
      const projectQueries: Record<string | symbol, unknown>[] = [];
      projectModel.findAll.mockImplementation(
        (options: { where: Record<string | symbol, unknown> }) => {
          projectQueries.push(options.where);
          // ครั้งแรก = ค้นโครงการจากคำค้น · ครั้งที่สอง = โครงการที่ผู้ตรวจเป็นผู้จัดการ
          return Promise.resolve(projectQueries.length === 1 ? [{ id: 4 }] : [{ id: 15 }]);
        },
      );
      let taskWhere: Record<string | symbol, unknown> = {};
      taskModel.findAll.mockImplementation(
        (options: { where: Record<string | symbol, unknown> }) => {
          taskWhere = options.where;
          return Promise.resolve([]);
        },
      );

      await service.findReviews(
        { tab: 'PENDING', search: 'PRJ-2026', page: 1, limit: 20, offset: 0 } as never,
        reviewer,
      );

      expect(projectQueries[0][Op.or]).toEqual([
        { code: { [Op.like]: '%PRJ-2026%' } },
        { name: { [Op.like]: '%PRJ-2026%' } },
      ]);
      expect(taskWhere[Op.and]).toEqual([
        { [Op.or]: [{ title: { [Op.like]: '%PRJ-2026%' } }, { projectId: { [Op.in]: [4] } }] },
        { [Op.or]: [{ assignedByUserId: 8 }, { projectId: { [Op.in]: [15] } }] },
      ]);
    });

    it('sortBy=projectCode เอาแถวที่ไม่มีรหัสไว้ท้ายก่อน แล้วค่อยเรียงตามทิศที่ขอ', async () => {
      const captured = captureSubmissionQuery();

      await service.findReviews(
        {
          tab: 'REVIEWED',
          sortBy: 'projectCode',
          sortOrder: 'DESC',
          page: 1,
          limit: 20,
          offset: 0,
        } as never,
        admin,
      );

      const order = captured.order as unknown[][];
      expect(order[0][1]).toBe('ASC');
      expect(JSON.stringify(order[0][0])).toContain('ISNULL');
      expect(order[1][1]).toBe('DESC');
      expect(order[2]).toEqual(['id', 'DESC']);
    });

    it('ไม่ส่ง sortBy = ลำดับเริ่มต้นของแท็บเดิม แม้ sortOrder มีค่าเริ่มต้นเป็น DESC', async () => {
      const captured = captureSubmissionQuery();
      taskModel.findAll.mockResolvedValue([]);

      await service.findReviews(
        { tab: 'PENDING', sortOrder: 'DESC', page: 1, limit: 20, offset: 0 } as never,
        admin,
      );

      expect(captured.order?.[0]).toEqual(['createdAt', 'ASC']);
    });

    it('countPendingReviews = total ของแท็บรอตรวจ', async () => {
      submissionModel.findAndCountAll.mockResolvedValue({ rows: [], count: 7 });
      taskModel.findAll.mockResolvedValue([]);

      await expect(service.countPendingReviews(admin)).resolves.toBe(7);
    });

    it('ไม่มีสิทธิ์ task.review = 403', async () => {
      accessControl.hasPermission.mockResolvedValue(false);

      await expect(
        service.findReviews({ tab: 'PENDING', page: 1, limit: 20, offset: 0 } as never, reviewer),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('countRejectedMyTasks (badge งานโปรเจกต์)', () => {
    it('นับเฉพาะงานที่รอบส่งล่าสุดถูกตีกลับ', async () => {
      taskModel.findAll.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);
      // เรียงล่าสุดก่อนตาม order ของ query
      submissionModel.findAll.mockResolvedValue([
        { taskId: 1, status: 'REJECTED' },
        { taskId: 2, status: 'APPROVED' },
        { taskId: 2, status: 'REJECTED' },
        { taskId: 1, status: 'REJECTED' },
      ]);

      await expect(service.countRejectedMyTasks(8)).resolves.toBe(1);
      expect(taskModel.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            assignedUserId: 8,
            status: { [Op.in]: [TaskStatus.DOING, TaskStatus.WAITING] },
          },
        }),
      );
    });

    it('ไม่มีงานค้าง = 0 โดยไม่ query รอบส่ง', async () => {
      taskModel.findAll.mockResolvedValue([]);

      await expect(service.countRejectedMyTasks(8)).resolves.toBe(0);
      expect(submissionModel.findAll).not.toHaveBeenCalled();
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
  // M2-06 งานใกล้ครบกำหนด
  // -------------------------------------------------------------------------
  describe('findDueSoon', () => {
    type DueSoonWhere = {
      dueDate: Record<symbol, string[]>;
      status: Record<symbol, TaskStatus>;
      projectId?: number;
      assignedUserId?: number;
    };

    function captureWhere(): () => DueSoonWhere {
      let captured: DueSoonWhere = { dueDate: {}, status: {} };
      taskModel.findAndCountAll.mockImplementation((options: { where: DueSoonWhere }) => {
        captured = options.where;
        return Promise.resolve({ rows: [], count: 0 });
      });
      return () => captured;
    }

    it('นับตั้งแต่วันนี้ถึงอีก N วัน และไม่เอางานที่เสร็จแล้ว', async () => {
      const where = captureWhere();

      await service.findDueSoon({ page: 1, limit: 20, offset: 0, withinDays: 7 } as never);

      const today = todayAsDateOnly();
      expect(where().dueDate[Op.between]).toEqual([today, addDays(today, 7)]);
      expect(where().status[Op.ne]).toBe(TaskStatus.DONE);
    });

    it('ขอบล่างคือวันนี้ ต่อกับงานเกินกำหนดพอดี — งานที่ครบกำหนดวันนี้อยู่ในรายการนี้', async () => {
      // findOverdue ใช้ dueDate < วันนี้ ถ้าที่นี่เริ่มจากพรุ่งนี้ งานที่ครบกำหนดวันนี้จะหายจากทั้งสองรายการ
      const where = captureWhere();

      await service.findDueSoon({ page: 1, limit: 20, offset: 0, withinDays: 0 } as never);

      expect(where().dueDate[Op.between]).toEqual([todayAsDateOnly(), todayAsDateOnly()]);
    });

    it('กรองตามโครงการและผู้รับผิดชอบได้', async () => {
      const where = captureWhere();

      await service.findDueSoon({
        page: 1,
        limit: 20,
        offset: 0,
        withinDays: 7,
        projectId: 4,
        assignedUserId: 3,
      } as never);

      expect(where().projectId).toBe(4);
      expect(where().assignedUserId).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // M2-07 รายการงานทั้งบริษัท
  // -------------------------------------------------------------------------
  describe('findCompanyTasks', () => {
    it('พ่วงโครงการที่งานสังกัดมาด้วย และไม่คืนงานย่อยซ้อน', async () => {
      taskModel.findAndCountAll.mockResolvedValue({
        rows: [
          taskRow({
            id: 7,
            project: { id: 2, code: 'PRJ-2', name: 'ระบบคลัง', status: 'IN_PROGRESS' },
            subTasks: [taskRow({ id: 8 })],
          } as never),
        ],
        count: 1,
      });

      const result = await service.findCompanyTasks({ page: 1, limit: 20, offset: 0 } as never);

      expect(result.items[0].project).toEqual({
        id: 2,
        code: 'PRJ-2',
        name: 'ระบบคลัง',
        status: 'IN_PROGRESS',
      });
      // รายการแบบแบน — งานย่อยมีแถวของตัวเองอยู่แล้ว ไม่ต้องซ้อนซ้ำใต้งานแม่
      expect(result.items[0].subTasks).toEqual([]);
    });

    it('ไม่ระบุการเรียง = วันครบกำหนดใกล้สุดก่อน โดยงานที่ไม่มีวันครบกำหนดไปอยู่ท้าย', async () => {
      let order: unknown[] = [];
      taskModel.findAndCountAll.mockImplementation((options: { order: unknown[] }) => {
        order = options.order;
        return Promise.resolve({ rows: [], count: 0 });
      });

      await service.findCompanyTasks({ page: 1, limit: 20, offset: 0 } as never);

      // ตัวแรกคือ ISNULL(due_date) — ถ้าหายไป MySQL จะเอางานที่ไม่มีวันครบกำหนดขึ้นก่อน
      expect(Array.isArray(order[0]) && typeof (order[0] as unknown[])[0]).toBe('object');
      expect(order[1]).toEqual(['dueDate', 'ASC']);
    });

    it('ชื่อฟิลด์เรียงที่ไม่อยู่ในรายการอนุญาตถูกเมิน ไม่ส่งต่อให้ฐานข้อมูล', async () => {
      let order: unknown[] = [];
      taskModel.findAndCountAll.mockImplementation((options: { order: unknown[] }) => {
        order = options.order;
        return Promise.resolve({ rows: [], count: 0 });
      });

      await service.findCompanyTasks({
        page: 1,
        limit: 20,
        offset: 0,
        sortBy: 'password_hash',
        sortOrder: 'ASC',
      } as never);

      expect(JSON.stringify(order)).not.toContain('password_hash');
    });

    it('กรองตามสถานะและความสำคัญได้', async () => {
      let where: Record<string, unknown> = {};
      taskModel.findAndCountAll.mockImplementation(
        (options: { where: Record<string, unknown> }) => {
          where = options.where;
          return Promise.resolve({ rows: [], count: 0 });
        },
      );

      await service.findCompanyTasks({
        page: 1,
        limit: 20,
        offset: 0,
        status: TaskStatus.WAITING,
        priority: TaskPriority.HIGH,
      } as never);

      expect(where.status).toBe(TaskStatus.WAITING);
      expect(where.priority).toBe(TaskPriority.HIGH);
    });
  });

  // -------------------------------------------------------------------------
  // M2-07 ภาพรวมงานทั้งบริษัท
  // -------------------------------------------------------------------------
  describe('summarizeBoard', () => {
    const today = todayAsDateOnly();
    const yesterday = addDays(today, -1);

    function row(status: TaskStatus, dueDate: string | null, assignedUserId: number | null) {
      return { id: Math.random(), status, dueDate, assignedUserId };
    }

    it('คืนครบทุกสถานะแม้ไม่มีงาน หน้าจอจะวาดคอลัมน์ได้ครบโดยไม่ต้องเติมเอง', async () => {
      taskModel.findAll.mockResolvedValue([]);

      const summary = await service.summarizeBoard({});

      expect(summary.byStatus).toEqual({ TODO: 0, DOING: 0, WAITING: 0, REVIEW: 0, DONE: 0 });
      expect(summary.overdueByStatus).toEqual({ TODO: 0, DOING: 0, WAITING: 0, REVIEW: 0 });
      expect(summary.byAssignee).toEqual([]);
    });

    it('นับเกินกำหนดด้วยกติกาเดียวกับทั้งระบบ — ครบกำหนดวันนี้ไม่เกิน และงานที่เสร็จแล้วไม่เกิน', async () => {
      taskModel.findAll.mockResolvedValue([
        row(TaskStatus.WAITING, yesterday, 3), // เกิน
        row(TaskStatus.DOING, today, 3), // ครบกำหนดวันนี้ ยังไม่เกิน
        row(TaskStatus.DONE, yesterday, 3), // เสร็จแล้ว ไม่นับ
        row(TaskStatus.TODO, null, 3), // ไม่มีวันครบกำหนด ไม่เกิน
      ]);
      userModel.findAll.mockResolvedValue([{ id: 3, fullName: 'สมชาย' }]);

      const summary = await service.summarizeBoard({});

      expect(summary.totalTasks).toBe(4);
      expect(summary.openTasks).toBe(3);
      expect(summary.overdueTasks).toBe(1);
      expect(summary.overdueByStatus.WAITING).toBe(1);
      expect(summary.overdueByStatus.DOING).toBe(0);
    });

    it('ภาระงานรายคนนับเฉพาะงานที่ยังไม่เสร็จ รวมงานที่ยังไม่มีผู้รับผิดชอบ และเรียงคนที่เกินกำหนดมากสุดก่อน', async () => {
      taskModel.findAll.mockResolvedValue([
        row(TaskStatus.DOING, today, 3),
        row(TaskStatus.DONE, today, 3),
        row(TaskStatus.WAITING, yesterday, 5),
        row(TaskStatus.REVIEW, yesterday, 5),
        row(TaskStatus.TODO, null, null),
      ]);
      userModel.findAll.mockResolvedValue([
        { id: 3, fullName: 'สมชาย' },
        { id: 5, fullName: 'ปราณี' },
      ]);

      const summary = await service.summarizeBoard({});

      expect(summary.byAssignee.map((load) => load.assignedUserId)).toEqual([5, 3, null]);
      expect(summary.byAssignee[0]).toMatchObject({
        fullName: 'ปราณี',
        openTasks: 2,
        overdueTasks: 2,
        byStatus: { TODO: 0, DOING: 0, WAITING: 1, REVIEW: 1 },
      });
      // งาน DONE ของสมชายไม่ถูกนับเป็นภาระ
      expect(summary.byAssignee[1]).toMatchObject({ fullName: 'สมชาย', openTasks: 1 });
      expect(summary.byAssignee[2]).toMatchObject({ fullName: null, openTasks: 1 });
    });

    it('หาชื่อพนักงานที่ลาออกไปแล้วด้วย เพื่อให้รู้ว่างานค้างอยู่กับใครต้องส่งต่อ', async () => {
      taskModel.findAll.mockResolvedValue([row(TaskStatus.DOING, null, 9)]);
      let options: { paranoid?: boolean } = {};
      userModel.findAll.mockImplementation((given: { paranoid?: boolean }) => {
        options = given;
        return Promise.resolve([{ id: 9, fullName: 'อดีตพนักงาน' }]);
      });

      const summary = await service.summarizeBoard({});

      expect(options.paranoid).toBe(false);
      expect(summary.byAssignee[0].fullName).toBe('อดีตพนักงาน');
    });

    it('ไม่มีงานที่มีผู้รับผิดชอบเลย = ไม่ต้องไปค้นตารางผู้ใช้', async () => {
      taskModel.findAll.mockResolvedValue([row(TaskStatus.TODO, null, null)]);

      await service.summarizeBoard({});

      expect(userModel.findAll).not.toHaveBeenCalled();
    });

    it('สรุปเฉพาะโครงการเดียวได้', async () => {
      let where: Record<string, unknown> = {};
      taskModel.findAll.mockImplementation((options: { where: Record<string, unknown> }) => {
        where = options.where;
        return Promise.resolve([]);
      });

      await service.summarizeBoard({ projectId: 4 });

      expect(where).toEqual({ projectId: 4 });
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
