/// <reference types="jest" />
// TypeScript 6 ไม่ดึง @types/jest เข้ามาให้อัตโนมัติ ต้องอ้างถึงตรงนี้เหมือน spec ตัวอื่น

import { Readable } from 'node:stream';

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Op } from 'sequelize';

import { runWithRequestContext } from '../../common/context/request-context';
import { Document, DocumentType, Project, User } from '../../models';
import type { StorageService } from '../files/storage.service';
import type { UploadedFileLike } from '../files/upload.util';
import { DocumentsService } from './documents.service';

/**
 * เอกสารของโครงการ (Phase 9 — ประชุม 11 ก.ย. B-5)
 *
 * กฎที่เทสต์ชุดนี้ปักหมุดไว้
 *   1. ไม่แยกประเภทเอกสาร — ระบบบันทึก doc_type = OTHER ให้เสมอ
 *   2. ลูกค้าคัดลอกจากโครงการ ไม่รับจาก client
 *   3. ตรวจไฟล์ก่อนส่งขึ้นที่เก็บ ไฟล์ที่ใช้ไม่ได้ต้องไม่ถูกอัปโหลดเลย
 *   4. ลบแล้วไฟล์ในที่เก็บยังอยู่ (หลักฐาน)
 *   5. response ไม่คืน object key ของที่เก็บ
 */

function documentRow(overrides: Record<string, unknown> = {}): Document {
  return {
    id: 12,
    projectId: 3,
    customerId: 1,
    docType: DocumentType.OTHER,
    title: 'ใบเสนอราคา',
    note: null,
    fileUrl: 'projects/3/2026/09/abc.pdf',
    fileName: 'ใบเสนอราคา.pdf',
    fileSize: 1024,
    mimeType: 'application/pdf',
    createdBy: 4,
    createdAt: new Date('2026-09-11T00:00:00Z'),
    updatedAt: new Date('2026-09-11T00:00:00Z'),
    update: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Document;
}

function pdf(name = 'ใบเสนอราคา.pdf'): UploadedFileLike {
  return { originalname: name, mimetype: 'application/pdf', size: 3, buffer: Buffer.from('pdf') };
}

describe('DocumentsService', () => {
  let documentModel: { findOne: jest.Mock; findAndCountAll: jest.Mock; create: jest.Mock };
  let projectModel: { findByPk: jest.Mock };
  let userModel: { findAll: jest.Mock };
  let storage: { put: jest.Mock; get: jest.Mock };
  let service: DocumentsService;

  beforeEach(() => {
    documentModel = {
      findOne: jest.fn().mockResolvedValue(documentRow()),
      findAndCountAll: jest.fn().mockResolvedValue({ rows: [documentRow()], count: 1 }),
      create: jest.fn().mockResolvedValue(documentRow()),
    };
    projectModel = { findByPk: jest.fn().mockResolvedValue({ id: 3, customerId: 1 }) };
    userModel = { findAll: jest.fn().mockResolvedValue([{ id: 4, fullName: 'สมชาย ใจดี' }]) };
    storage = {
      put: jest.fn().mockResolvedValue({ key: 'projects/3/2026/09/abc.pdf', driver: 'r2' }),
      get: jest.fn().mockResolvedValue({ stream: Readable.from(['x']), contentLength: 1 }),
    };

    service = new DocumentsService(
      documentModel as unknown as typeof Document,
      projectModel as unknown as typeof Project,
      userModel as unknown as typeof User,
      storage as unknown as StorageService,
    );
  });

  describe('upload', () => {
    it('ไม่แยกประเภท และคัดลอกลูกค้าจากโครงการ', async () => {
      projectModel.findByPk.mockResolvedValue({ id: 3, customerId: 9 });

      await service.upload(3, pdf(), { title: 'ใบเสนอราคา งวด 1' });

      expect(documentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 3,
          customerId: 9,
          docType: DocumentType.OTHER,
          title: 'ใบเสนอราคา งวด 1',
          fileUrl: 'projects/3/2026/09/abc.pdf',
          fileName: 'ใบเสนอราคา.pdf',
        }),
      );
    });

    it('ไม่ตั้งชื่อ → ใช้ชื่อไฟล์เป็นชื่อเอกสาร', async () => {
      await service.upload(3, pdf('แผนงาน.pdf'), {});

      expect(documentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'แผนงาน.pdf' }),
      );
    });

    it('key ในที่เก็บอยู่ใต้โฟลเดอร์ของโครงการ', async () => {
      await service.upload(3, pdf(), {});

      const [key] = storage.put.mock.calls[0] as [string];
      expect(key).toMatch(/^projects\/3\//);
    });

    it('ไฟล์ประเภทที่ไม่รับ → 400 และไม่มีอะไรถูกอัปโหลด', async () => {
      await expect(service.upload(3, pdf('virus.exe'), {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(storage.put).not.toHaveBeenCalled();
      expect(documentModel.create).not.toHaveBeenCalled();
    });

    it('ไม่พบโครงการ → 404 และไม่มีอะไรถูกอัปโหลด', async () => {
      projectModel.findByPk.mockResolvedValue(null);

      await expect(service.upload(99, pdf(), {})).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('บันทึกผู้อัปโหลดจาก request context (BR-09)', async () => {
      await runWithRequestContext(
        { userId: 42, ipAddress: null, userAgent: null, startedAt: Date.now() },
        () => service.upload(3, pdf(), {}),
      );

      expect(documentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ createdBy: 42, updatedBy: 42 }),
      );
    });
  });

  describe('response', () => {
    it('ไม่คืน object key ของที่เก็บ — ให้ดาวน์โหลดผ่าน downloadUrl ที่ตรวจสิทธิ์', async () => {
      const result = await service.findOne(12);

      expect(JSON.stringify(result)).not.toContain('projects/3/2026/09/abc.pdf');
      expect(result.downloadUrl).toBe('/api/documents/12/download');
      expect(result.uploadedBy).toEqual({ id: 4, fullName: 'สมชาย ใจดี' });
    });

    it('หาชื่อผู้อัปโหลดรวมคนที่ลาออกไปแล้ว', async () => {
      await service.findOne(12);

      expect(userModel.findAll).toHaveBeenCalledWith(expect.objectContaining({ paranoid: false }));
    });
  });

  it('เปิดได้เฉพาะเอกสารที่ผูกกับโครงการ', async () => {
    let captured: Record<string, unknown> = {};
    documentModel.findOne.mockImplementation((options: { where: Record<string, unknown> }) => {
      captured = options.where;
      return Promise.resolve(documentRow());
    });

    await service.findOne(12);

    expect(captured).toEqual({ id: 12, projectId: { [Op.ne]: null } });
  });

  it('ลบ = soft delete แถวพร้อมผู้ลบ ไฟล์ในที่เก็บไม่ถูกแตะ', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const destroy = jest.fn().mockResolvedValue(undefined);
    documentModel.findOne.mockResolvedValue(documentRow({ update, destroy }));

    await runWithRequestContext(
      { userId: 42, ipAddress: null, userAgent: null, startedAt: Date.now() },
      () => service.remove(12),
    );

    expect(update).toHaveBeenCalledWith({ deletedBy: 42 });
    expect(destroy).toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('แก้ได้แค่ชื่อกับรายละเอียด', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    documentModel.findOne.mockResolvedValue(documentRow({ update }));

    await service.update(12, { title: 'ชื่อใหม่', note: null });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ title: 'ชื่อใหม่', note: null }));
    const [values] = update.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(values)).not.toContain('fileUrl');
  });

  it('ดาวน์โหลดคืนชื่อไฟล์เดิมและชนิดไฟล์ไปด้วย', async () => {
    const file = await service.openFile(12);

    expect(storage.get).toHaveBeenCalledWith('projects/3/2026/09/abc.pdf');
    expect(file.fileName).toBe('ใบเสนอราคา.pdf');
    expect(file.mimeType).toBe('application/pdf');
  });
});
