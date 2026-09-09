/// <reference types="jest" />
// TypeScript 6 ไม่ดึง @types/jest เข้ามาให้อัตโนมัติ ต้องอ้างถึงตรงนี้เหมือน spec ตัวอื่น

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Op } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

import { CommunicationLog, Contact } from '../../models';
import { ContactsService } from './contacts.service';
import type { CustomersService } from './customers.service';

/**
 * เทสต์กฎ "ผู้ติดต่อหลักมีได้คนเดียวต่อลูกค้า 1 ราย" (CLAUDE.md 14)
 *
 * จุดที่พังง่ายที่สุดคือการถอดคนเดิมออก ถ้าลืมทำหรือทำนอกทรานแซกชัน
 * จะมีจังหวะที่ลูกค้ารายเดียวมีผู้ติดต่อหลักสองคนพร้อมกัน
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

function baseContactRow() {
  return {
    id: 7,
    customerId: 1,
    name: 'คุณสมศรี จัดซื้อ',
    nickname: null as string | null,
    position: null as string | null,
    phone: null as string | null,
    email: null as string | null,
    lineId: null as string | null,
    isPrimary: false,
    note: null as string | null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    update: jest.fn(),
    destroy: jest.fn(),
  };
}

type ContactRow = ReturnType<typeof baseContactRow>;

function contactRow(overrides: Partial<ContactRow> = {}): ContactRow {
  return { ...baseContactRow(), ...overrides };
}

describe('ContactsService', () => {
  let contactModel: ModelMock;
  let logModel: ModelMock;
  let sequelize: { transaction: jest.Mock };
  let customersService: { findOrFail: jest.Mock };
  let service: ContactsService;

  beforeEach(() => {
    contactModel = modelMock();
    logModel = modelMock();
    sequelize = {
      transaction: jest.fn((callback: (t: unknown) => Promise<unknown>) => callback(TRANSACTION)),
    };
    customersService = { findOrFail: jest.fn().mockResolvedValue({ id: 1 }) };

    contactModel.findAll.mockResolvedValue([]);
    contactModel.create.mockResolvedValue({ id: 7 });
    contactModel.findByPk.mockResolvedValue(contactRow());
    logModel.count.mockResolvedValue(0);

    service = new ContactsService(
      contactModel as unknown as typeof Contact,
      logModel as unknown as typeof CommunicationLog,
      sequelize as unknown as Sequelize,
      customersService as unknown as CustomersService,
    );
  });

  // -------------------------------------------------------------------------
  // ตั้งผู้ติดต่อหลักคนใหม่ = ถอดคนเดิมอัตโนมัติ
  // -------------------------------------------------------------------------
  describe('ผู้ติดต่อหลัก', () => {
    it('ถอดคนเดิมออกเมื่อสร้างคนใหม่เป็นผู้ติดต่อหลัก', async () => {
      const incumbent = contactRow({ id: 3, isPrimary: true });
      contactModel.findAll.mockResolvedValue([incumbent]);

      await service.create({ customerId: 1, name: 'คนใหม่', isPrimary: true }, 9);

      expect(contactModel.findAll).toHaveBeenCalledWith({
        where: { customerId: 1, isPrimary: true },
        transaction: TRANSACTION,
      });
      expect(incumbent.update).toHaveBeenCalledWith(
        { isPrimary: false, updatedBy: 9 },
        { transaction: TRANSACTION },
      );
    });

    it('ถอดคนเดิมและตั้งคนใหม่อยู่ในทรานแซกชันเดียวกัน', async () => {
      // ถ้าแยกทรานแซกชัน จะมีช่วงเวลาที่ไม่มีผู้ติดต่อหลักเลย หรือมีสองคนพร้อมกัน
      const incumbent = contactRow({ id: 3, isPrimary: true });
      contactModel.findAll.mockResolvedValue([incumbent]);

      await service.create({ customerId: 1, name: 'คนใหม่', isPrimary: true }, 9);

      expect(sequelize.transaction).toHaveBeenCalledTimes(1);
      expect(incumbent.update).toHaveBeenCalledWith(expect.anything(), {
        transaction: TRANSACTION,
      });
    });

    it('ถอดคนเดิมได้หลายคน เผื่อข้อมูลเก่าเพี้ยนจนมีผู้ติดต่อหลักซ้อนกัน', async () => {
      const first = contactRow({ id: 3, isPrimary: true });
      const second = contactRow({ id: 4, isPrimary: true });
      contactModel.findAll.mockResolvedValue([first, second]);

      await service.create({ customerId: 1, name: 'คนใหม่', isPrimary: true }, 9);

      expect(first.update).toHaveBeenCalledTimes(1);
      expect(second.update).toHaveBeenCalledTimes(1);
    });

    it('ไม่ไปยุ่งกับใครเมื่อสร้างผู้ติดต่อธรรมดา', async () => {
      await service.create({ customerId: 1, name: 'คนธรรมดา', isPrimary: false }, 9);

      expect(contactModel.findAll).not.toHaveBeenCalled();
    });

    it('ไม่ไปยุ่งกับใครเมื่อไม่ได้ระบุ isPrimary มาเลย', async () => {
      await service.create({ customerId: 1, name: 'คนธรรมดา' }, 9);

      expect(contactModel.findAll).not.toHaveBeenCalled();
    });

    it('ยกเว้นตัวเองตอนถอดคนเดิมในการแก้ไข', async () => {
      // ถ้าไม่ยกเว้น คนที่กำลังถูกตั้งเป็นหลักจะถูกถอดด้วยคำสั่งของตัวเอง
      contactModel.findByPk.mockResolvedValue(contactRow({ id: 7, isPrimary: false }));

      let captured: { customerId: number; isPrimary: boolean; id: Record<symbol, number> } = {
        customerId: 0,
        isPrimary: false,
        id: {},
      };
      contactModel.findAll.mockImplementation(
        (options: {
          where: { customerId: number; isPrimary: boolean; id: Record<symbol, number> };
        }) => {
          captured = options.where;
          return Promise.resolve([]);
        },
      );

      await service.update(7, { isPrimary: true }, 9);

      expect(captured.customerId).toBe(1);
      expect(captured.isPrimary).toBe(true);
      expect(captured.id[Op.ne]).toBe(7);
    });

    it('ไม่ถอดใครเมื่อสั่งตั้งเป็นหลักทั้งที่เป็นหลักอยู่แล้ว', async () => {
      contactModel.findByPk.mockResolvedValue(contactRow({ id: 7, isPrimary: true }));

      await service.update(7, { isPrimary: true }, 9);

      expect(contactModel.findAll).not.toHaveBeenCalled();
    });

    it('ไม่ถอดใครเมื่อแก้ไขเรื่องอื่นที่ไม่เกี่ยวกับ isPrimary', async () => {
      await service.update(7, { phone: '081-000-0000' }, 9);

      expect(contactModel.findAll).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // ลบผู้ติดต่อไม่ได้ถ้ายังถูกอ้างอิงในบันทึกการติดต่อ
  // -------------------------------------------------------------------------
  describe('remove', () => {
    it('ลบไม่ได้เมื่อยังถูกอ้างอิงในบันทึกการติดต่อ', async () => {
      // บันทึกการติดต่อคือหลักฐานว่าคุยกับใคร ถ้าลบคนได้ ประวัติจะเหลือแต่ชื่อลูกค้า
      const contact = contactRow();
      contactModel.findByPk.mockResolvedValue(contact);
      logModel.count.mockResolvedValue(3);

      await expect(service.remove(7, 9)).rejects.toBeInstanceOf(BadRequestException);
      expect(contact.destroy).not.toHaveBeenCalled();
    });

    it('ลบได้เมื่อไม่มีบันทึกการติดต่ออ้างอิง และบันทึกผู้ลบไว้ก่อน', async () => {
      const contact = contactRow();
      contactModel.findByPk.mockResolvedValue(contact);

      await service.remove(7, 9);

      expect(contact.update).toHaveBeenCalledWith({ deletedBy: 9 });
      expect(contact.destroy).toHaveBeenCalledTimes(1);
    });

    it('โยน 404 เมื่อไม่พบผู้ติดต่อ', async () => {
      contactModel.findByPk.mockResolvedValue(null);

      await expect(service.remove(999, 9)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('โยน 404 ต่อจาก CustomersService เมื่อสร้างผู้ติดต่อให้ลูกค้าที่ไม่มีอยู่', async () => {
    // ปล่อยให้ FK พังเองจะได้ข้อความที่ผู้ใช้อ่านไม่รู้เรื่อง
    customersService.findOrFail.mockRejectedValue(new NotFoundException('ไม่พบข้อมูลลูกค้า'));

    await expect(service.create({ customerId: 999, name: 'x' }, 9)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });
});
