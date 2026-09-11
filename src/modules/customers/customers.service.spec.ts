/// <reference types="jest" />
// TypeScript 6 ไม่ดึง @types/jest เข้ามาให้อัตโนมัติ ต้องอ้างถึงตรงนี้เหมือน spec ตัวอื่น

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { type ClassConstructor, plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Op } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

import {
  CommunicationLog,
  Contact,
  Customer,
  CustomerStatus,
  Project,
  Ticket,
  User,
  UserStatus,
} from '../../models';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { QueryCustomersDto } from './dto/query-customers.dto';

/**
 * เทสต์กฎธุรกิจของ Phase 4 ที่ CLAUDE.md 14 ระบุว่า "อย่าเขียนทับตอนต่อยอด"
 *
 * ไม่แตะฐานข้อมูลจริง — model ทุกตัวถูกแทนด้วย mock ที่คืนค่าตามที่กำหนดไว้
 * สิ่งที่ทดสอบคือ "service ตัดสินใจอย่างไรเมื่อได้ข้อมูลแบบนี้" ไม่ใช่ SQL ที่ Sequelize สร้าง
 */

interface ModelMock {
  findByPk: jest.Mock;
  findOne: jest.Mock;
  findAll: jest.Mock;
  findAndCountAll: jest.Mock;
  create: jest.Mock;
  count: jest.Mock;
  destroy: jest.Mock;
}

function modelMock(): ModelMock {
  return {
    findByPk: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
    destroy: jest.fn(),
  };
}

/** ตัวแทน transaction — service สนใจแค่ว่าค่านี้ถูกส่งต่อไปทุกคำสั่งในชุดเดียวกันหรือไม่ */
const TRANSACTION = { name: 'tx' };

function baseCustomerRow() {
  return {
    id: 1,
    code: 'CUS-001' as string | null,
    name: 'บริษัท ตัวอย่าง จำกัด',
    taxId: null as string | null,
    businessType: null as string | null,
    address: null as string | null,
    province: null as string | null,
    postalCode: null as string | null,
    phone: null as string | null,
    email: null as string | null,
    website: null as string | null,
    lineOfficialId: null as string | null,
    facebookUrl: null as string | null,
    status: CustomerStatus.ACTIVE,
    source: null as string | null,
    ownerUserId: null as number | null,
    owner: null,
    lastContactedAt: null as Date | null,
    note: null as string | null,
    contacts: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    update: jest.fn(),
    destroy: jest.fn(),
    save: jest.fn(),
  };
}

type CustomerRow = ReturnType<typeof baseCustomerRow>;

function customerRow(overrides: Partial<CustomerRow> = {}): CustomerRow {
  return { ...baseCustomerRow(), ...overrides };
}

function queryDto(overrides: Record<string, unknown> = {}): QueryCustomersDto {
  return {
    page: 1,
    limit: 20,
    offset: 0,
    sortOrder: 'DESC',
    ...overrides,
  } as unknown as QueryCustomersDto;
}

describe('CustomersService', () => {
  let customerModel: ModelMock;
  let contactModel: ModelMock;
  let logModel: ModelMock;
  let projectModel: ModelMock;
  let ticketModel: ModelMock;
  let userModel: ModelMock;
  let sequelize: { transaction: jest.Mock };
  let service: CustomersService;

  beforeEach(() => {
    customerModel = modelMock();
    contactModel = modelMock();
    logModel = modelMock();
    projectModel = modelMock();
    ticketModel = modelMock();
    userModel = modelMock();
    sequelize = {
      transaction: jest.fn((callback: (t: unknown) => Promise<unknown>) => callback(TRANSACTION)),
    };

    service = new CustomersService(
      customerModel as unknown as typeof Customer,
      contactModel as unknown as typeof Contact,
      logModel as unknown as typeof CommunicationLog,
      projectModel as unknown as typeof Project,
      ticketModel as unknown as typeof Ticket,
      userModel as unknown as typeof User,
      sequelize as unknown as Sequelize,
    );
  });

  // -------------------------------------------------------------------------
  // lastContactedAt ต้องไม่ถอยหลัง (BR-02 + CLAUDE.md 14)
  // -------------------------------------------------------------------------
  describe('touchLastContactedAt', () => {
    it('บันทึกเวลาให้เมื่อลูกค้ายังไม่เคยถูกติดต่อ', async () => {
      const customer = customerRow({ lastContactedAt: null });
      customerModel.findByPk.mockResolvedValue(customer);

      const occurredAt = new Date('2026-09-01T10:00:00Z');
      await service.touchLastContactedAt(1, occurredAt);

      expect(customer.lastContactedAt).toBe(occurredAt);
      expect(customer.save).toHaveBeenCalledTimes(1);
    });

    it('เลื่อนเวลาไปข้างหน้าเมื่อบันทึกการติดต่อที่ใหม่กว่าค่าเดิม', async () => {
      const customer = customerRow({ lastContactedAt: new Date('2026-09-01T00:00:00Z') });
      customerModel.findByPk.mockResolvedValue(customer);

      const occurredAt = new Date('2026-09-05T00:00:00Z');
      await service.touchLastContactedAt(1, occurredAt);

      expect(customer.lastContactedAt).toBe(occurredAt);
      expect(customer.save).toHaveBeenCalledTimes(1);
    });

    it('ไม่ถอยเวลากลับเมื่อบันทึกการติดต่อย้อนหลัง', async () => {
      // หัวใจของกฎ — บันทึกการคุยเมื่อเดือนที่แล้วต้องไม่ทำให้ลูกค้าดูเหมือนเพิ่งติดต่อไป
      // แล้วหลุดออกจากหน้าจอ "ลูกค้าที่ถูกลืม" ทั้งที่ยังไม่ได้ติดต่อจริง
      const current = new Date('2026-09-05T00:00:00Z');
      const customer = customerRow({ lastContactedAt: current });
      customerModel.findByPk.mockResolvedValue(customer);

      await service.touchLastContactedAt(1, new Date('2026-08-01T00:00:00Z'));

      expect(customer.lastContactedAt).toBe(current);
      expect(customer.save).not.toHaveBeenCalled();
    });

    it('ไม่เขียนซ้ำเมื่อเวลาเท่ากับค่าเดิมเป๊ะ', async () => {
      const current = new Date('2026-09-05T00:00:00Z');
      const customer = customerRow({ lastContactedAt: current });
      customerModel.findByPk.mockResolvedValue(customer);

      await service.touchLastContactedAt(1, new Date('2026-09-05T00:00:00Z'));

      expect(customer.save).not.toHaveBeenCalled();
    });

    it('เงียบไปเฉย ๆ เมื่อไม่พบลูกค้า ไม่โยน error', async () => {
      // ถูกเรียกจาก CommunicationLogsService หลังบันทึกสำเร็จไปแล้ว
      // ถ้าโยน error ตรงนี้ บันทึกที่สร้างสำเร็จแล้วจะกลายเป็น response 500
      customerModel.findByPk.mockResolvedValue(null);

      await expect(service.touchLastContactedAt(999, new Date())).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // ลบลูกค้าไม่ได้ถ้ามีโครงการหรือใบแจ้งปัญหาผูกอยู่
  // -------------------------------------------------------------------------
  describe('remove', () => {
    beforeEach(() => {
      customerModel.findByPk.mockResolvedValue(customerRow());
      projectModel.count.mockResolvedValue(0);
      ticketModel.count.mockResolvedValue(0);
    });

    it('ลบไม่ได้เมื่อมีโครงการผูกอยู่ และต้องไม่เปิด transaction เลย', async () => {
      projectModel.count.mockResolvedValue(2);

      await expect(service.remove(1, 9)).rejects.toBeInstanceOf(BadRequestException);
      expect(sequelize.transaction).not.toHaveBeenCalled();
    });

    it('ลบไม่ได้เมื่อมีใบแจ้งปัญหาผูกอยู่', async () => {
      ticketModel.count.mockResolvedValue(1);

      await expect(service.remove(1, 9)).rejects.toBeInstanceOf(BadRequestException);
      expect(sequelize.transaction).not.toHaveBeenCalled();
    });

    it('บอกให้เปลี่ยนสถานะเป็น CHURNED แทนในข้อความ error', async () => {
      projectModel.count.mockResolvedValue(1);

      await expect(service.remove(1, 9)).rejects.toThrow(/CHURNED/);
    });

    it('ลบผู้ติดต่อและบันทึกการติดต่อตามไปด้วยในทรานแซกชันเดียว', async () => {
      const customer = customerRow();
      customerModel.findByPk.mockResolvedValue(customer);

      await service.remove(1, 9);

      expect(contactModel.destroy).toHaveBeenCalledWith({
        where: { customerId: 1 },
        transaction: TRANSACTION,
      });
      expect(logModel.destroy).toHaveBeenCalledWith({
        where: { customerId: 1 },
        transaction: TRANSACTION,
      });
      // deletedBy ต้องถูกเขียนก่อน destroy ไม่งั้น audit log ไม่รู้ว่าใครลบ (BR-09)
      expect(customer.update).toHaveBeenCalledWith({ deletedBy: 9 }, { transaction: TRANSACTION });
      expect(customer.destroy).toHaveBeenCalledWith({ transaction: TRANSACTION });
    });

    it('โยน 404 เมื่อไม่พบลูกค้า', async () => {
      customerModel.findByPk.mockResolvedValue(null);

      await expect(service.remove(999, 9)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // ผู้ดูแลต้องเป็นพนักงานที่ยังทำงานอยู่ (CLAUDE.md 4.3)
  // -------------------------------------------------------------------------
  describe('ผู้ดูแลลูกค้า', () => {
    const dto = { name: 'ลูกค้าใหม่', status: CustomerStatus.ACTIVE, ownerUserId: 5 };

    it('มอบหมายให้พนักงานที่ลาออกแล้วไม่ได้', async () => {
      userModel.findByPk.mockResolvedValue({ id: 5, status: UserStatus.RESIGNED });

      await expect(service.create(dto as CreateCustomerDto, 9)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(customerModel.create).not.toHaveBeenCalled();
    });

    it('มอบหมายให้พนักงานที่ถูกระงับสิทธิ์ไม่ได้', async () => {
      userModel.findByPk.mockResolvedValue({ id: 5, status: UserStatus.SUSPENDED });

      await expect(service.create(dto as CreateCustomerDto, 9)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('มอบหมายให้พนักงานที่ไม่มีในระบบไม่ได้', async () => {
      userModel.findByPk.mockResolvedValue(null);

      await expect(service.create(dto as CreateCustomerDto, 9)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // สถานะลูกค้า — ไม่มีผู้มุ่งหวัง บันทึกเฉพาะลูกค้าที่ใช้บริการจริง (ตกลง 10 ก.ย.)
  // -------------------------------------------------------------------------
  describe('สถานะลูกค้า', () => {
    it('ไม่ส่ง status มา = ACTIVE', async () => {
      customerModel.create.mockResolvedValue({ id: 1 });
      customerModel.findByPk.mockResolvedValue(customerRow());

      await service.create({ name: 'บริษัท ใหม่ จำกัด' }, 9);

      expect(customerModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: CustomerStatus.ACTIVE }),
        expect.anything(),
      );
    });

    it('ส่ง status มาเองได้ตามปกติ', async () => {
      customerModel.create.mockResolvedValue({ id: 1 });
      customerModel.findByPk.mockResolvedValue(customerRow());

      await service.create({ name: 'ลูกค้าเก่า', status: CustomerStatus.INACTIVE }, 9);

      expect(customerModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: CustomerStatus.INACTIVE }),
        expect.anything(),
      );
    });

    it('enum เหลือแค่ ACTIVE, INACTIVE, CHURNED', () => {
      expect(Object.values(CustomerStatus).sort()).toEqual(['ACTIVE', 'CHURNED', 'INACTIVE']);
    });

    // ValidationPipe ที่ระดับ global ใช้ class-validator ตัวเดียวกันนี้ — ถ้าผ่านที่นี่ไม่ได้
    // request จริงก็ได้ 400 พร้อมข้อความนี้
    async function statusErrorOf(dtoClass: ClassConstructor<object>, payload: object) {
      const errors = await validate(plainToInstance(dtoClass, payload));
      return errors.find((error) => error.property === 'status')?.constraints?.isEnum;
    }

    it('ฟอร์มเพิ่ม/แก้ลูกค้าปฏิเสธ status = PROSPECT', async () => {
      await expect(
        statusErrorOf(CreateCustomerDto, { name: 'ลูกค้า', status: 'PROSPECT' }),
      ).resolves.toBe('สถานะลูกค้าต้องเป็น ACTIVE, INACTIVE หรือ CHURNED');
    });

    it('ตัวกรองรายการลูกค้าปฏิเสธ status = PROSPECT', async () => {
      await expect(statusErrorOf(QueryCustomersDto, { status: 'PROSPECT' })).resolves.toBe(
        'สถานะลูกค้าต้องเป็น ACTIVE, INACTIVE หรือ CHURNED',
      );
    });
  });

  // -------------------------------------------------------------------------
  // รหัสลูกค้าห้ามซ้ำ รวมกับรายการที่ถูก soft delete ไปแล้ว
  // -------------------------------------------------------------------------
  describe('รหัสลูกค้า', () => {
    it('โยน 409 เมื่อรหัสซ้ำ และตรวจรวมรายการที่ถูกลบไปแล้วด้วย', async () => {
      // paranoid: false คือหัวใจ — unique index ในฐานข้อมูลไม่สนใจ deleted_at
      // ถ้าตรวจแบบมองข้ามรายการที่ลบแล้ว จะผ่าน service แต่ไปตายที่ระดับ DB
      customerModel.findOne.mockResolvedValue(customerRow());

      await expect(
        service.create({ name: 'x', code: 'CUS-001', status: CustomerStatus.ACTIVE }, 9),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(customerModel.findOne).toHaveBeenCalledWith({
        where: { code: 'CUS-001' },
        paranoid: false,
      });
    });

    it('ไม่ตรวจซ้ำเมื่อแก้ไขแล้วส่งรหัสเดิมกลับมา', async () => {
      const customer = customerRow({ code: 'CUS-001' });
      customerModel.findByPk.mockResolvedValue(customer);

      await service.update(1, { code: 'CUS-001' }, 9);

      expect(customerModel.findOne).not.toHaveBeenCalled();
    });

    it('ยกเว้นตัวเองตอนตรวจรหัสซ้ำในการแก้ไข', async () => {
      customerModel.findByPk.mockResolvedValue(customerRow({ code: 'CUS-001' }));
      let captured: { code: string; id: Record<symbol, number> } = { code: '', id: {} };
      customerModel.findOne.mockImplementation(
        (options: { where: { code: string; id: Record<symbol, number> } }) => {
          captured = options.where;
          return Promise.resolve(null);
        },
      );

      await service.update(1, { code: 'CUS-002' }, 9);

      expect(captured.code).toBe('CUS-002');
      expect(captured.id[Op.ne]).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // หน้าจอ "ลูกค้าที่ถูกลืม"
  // -------------------------------------------------------------------------
  describe('findAll ด้วย idleDays', () => {
    it('นับลูกค้าที่ยังไม่เคยติดต่อเลยรวมมาด้วย', async () => {
      // ถ้ากรองแค่ lastContactedAt < threshold ลูกค้าที่ไม่เคยติดต่อเลย (ค่าเป็น null)
      // จะหายไปจากหน้าจอ ทั้งที่เป็นกลุ่มที่ถูกลืมหนักที่สุด
      let captured: Record<symbol, unknown> = {};
      customerModel.findAndCountAll.mockImplementation(
        (options: { where: Record<symbol, unknown> }) => {
          captured = options.where;
          return Promise.resolve({ rows: [], count: 0 });
        },
      );

      await service.findAll(queryDto({ idleDays: 30 }));

      const and = captured[Op.and] as Record<symbol, unknown>[];
      const or = and[0][Op.or] as [
        { lastContactedAt: null },
        { lastContactedAt: Record<symbol, Date> },
      ];

      expect(or[0]).toEqual({ lastContactedAt: null });
      expect(or[1].lastContactedAt[Op.lt]).toBeInstanceOf(Date);
    });

    it('ไม่ใส่เงื่อนไข idle เมื่อไม่ได้ส่ง idleDays มา', async () => {
      let captured: Record<symbol, unknown> = {};
      customerModel.findAndCountAll.mockImplementation(
        (options: { where: Record<symbol, unknown> }) => {
          captured = options.where;
          return Promise.resolve({ rows: [], count: 0 });
        },
      );

      await service.findAll(queryDto());

      expect(captured[Op.and]).toBeUndefined();
    });

    it('ปฏิเสธ sortBy แปลกปลอมแล้วถอยไปใช้ createdAt', async () => {
      // กัน query string หลุดเข้า ORDER BY ตรง ๆ
      let captured: unknown[][] = [];
      customerModel.findAndCountAll.mockImplementation((options: { order: unknown[][] }) => {
        captured = options.order;
        return Promise.resolve({ rows: [], count: 0 });
      });

      await service.findAll(queryDto({ sortBy: 'name); DROP TABLE customers; --' }));

      expect(captured[0][0]).toBe('createdAt');
    });
  });
});
