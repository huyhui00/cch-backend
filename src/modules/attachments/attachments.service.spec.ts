/// <reference types="jest" />

import { Readable } from 'node:stream';

import { BadRequestException, NotFoundException } from '@nestjs/common';

import { runWithRequestContext } from '../../common/context/request-context';
import { Attachment, CommunicationLog, Delivery, MaContract, Ticket, TicketResolution, User } from '../../models';
import type { StorageService } from '../files/storage.service';
import type { UploadedFileLike } from '../files/upload.util';
import { AttachmentsService } from './attachments.service';

/**
 * ไฟล์แนบ Phase 9 ส่วนที่เหลือ
 *
 *   1. response ไม่คืน object key — มีแค่ downloadUrl
 *   2. ต้นทางต้องมีอยู่จริง
 *   3. เอกสารโปรเจค (PROJECT) ไม่อนุญาตผ่านเส้นนี้
 *   4. อัปโหลด MA_CONTRACT แล้วอัปเดต signed_file_url
 *   5. ลบแล้วไฟล์ในที่เก็บยังอยู่ (soft delete แถวอย่างเดียว)
 */

function attachmentRow(overrides: Record<string, unknown> = {}): Attachment {
  return {
    id: 12,
    refType: 'COMMUNICATION_LOG',
    refId: 5,
    fileUrl: 'communication-logs/5/2026/09/abc.png',
    fileName: 'หลักฐาน.png',
    fileSize: 1024,
    mimeType: 'image/png',
    note: null,
    uploadedByUserId: 4,
    createdBy: 4,
    createdAt: new Date('2026-09-22T00:00:00Z'),
    updatedAt: new Date('2026-09-22T00:00:00Z'),
    update: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Attachment;
}

function pdf(name = 'scan.pdf'): UploadedFileLike {
  return { originalname: name, mimetype: 'application/pdf', size: 3, buffer: Buffer.from('pdf') };
}

type ModelMock = {
  findByPk: jest.Mock;
  findAll: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
};

function modelMock(findByPkValue: unknown = { id: 1 }): ModelMock {
  return {
    findByPk: jest.fn().mockResolvedValue(findByPkValue),
    findAll: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn().mockResolvedValue([1]),
  };
}

describe('AttachmentsService', () => {
  let attachmentModel: ModelMock;
  let communicationLogModel: ModelMock;
  let deliveryModel: ModelMock;
  let ticketModel: ModelMock;
  let ticketResolutionModel: ModelMock;
  let maContractModel: ModelMock;
  let userModel: { findAll: jest.Mock };
  let storage: { put: jest.Mock; get: jest.Mock };
  let service: AttachmentsService;

  beforeEach(() => {
    attachmentModel = {
      ...modelMock(),
      findAll: jest.fn().mockResolvedValue([attachmentRow()]),
      create: jest.fn().mockResolvedValue(attachmentRow()),
      findByPk: jest.fn().mockResolvedValue(attachmentRow()),
    };
    communicationLogModel = modelMock({ id: 5 });
    deliveryModel = modelMock({ id: 3 });
    ticketModel = modelMock({ id: 7 });
    ticketResolutionModel = modelMock({ id: 9 });
    maContractModel = modelMock({ id: 4 });
    userModel = {
      findAll: jest.fn().mockResolvedValue([{ id: 4, fullName: 'สมชาย ใจดี' }]),
    };
    storage = {
      put: jest.fn().mockResolvedValue({
        key: 'communication-logs/5/2026/09/abc.pdf',
        driver: 'local',
      }),
      get: jest.fn().mockResolvedValue({ stream: Readable.from(['x']), contentLength: 1 }),
    };

    service = new AttachmentsService(
      attachmentModel as unknown as typeof Attachment,
      communicationLogModel as unknown as typeof CommunicationLog,
      deliveryModel as unknown as typeof Delivery,
      ticketModel as unknown as typeof Ticket,
      ticketResolutionModel as unknown as typeof TicketResolution,
      maContractModel as unknown as typeof MaContract,
      userModel as unknown as typeof User,
      storage as unknown as StorageService,
    );
  });

  describe('upload', () => {
    it('บันทึกแถวและคืน downloadUrl โดยไม่คืน object key', async () => {
      await runWithRequestContext(
        { userId: 4, ipAddress: null, userAgent: null, startedAt: Date.now() },
        async () => {
          const result = await service.upload(pdf('หลักฐาน.pdf'), {
            refType: 'COMMUNICATION_LOG',
            refId: 5,
          });

          expect(storage.put).toHaveBeenCalled();
          expect(attachmentModel.create).toHaveBeenCalledWith(
            expect.objectContaining({
              refType: 'COMMUNICATION_LOG',
              refId: 5,
              fileName: 'หลักฐาน.pdf',
              uploadedByUserId: 4,
            }),
          );
          expect(result.downloadUrl).toBe('/api/attachments/12/download');
          expect(result).not.toHaveProperty('fileUrl');
        },
      );
    });

    it('ต้นทางไม่มี → 404 และไม่อัปโหลด', async () => {
      communicationLogModel.findByPk.mockResolvedValue(null);

      await expect(
        service.upload(pdf(), { refType: 'COMMUNICATION_LOG', refId: 99 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('ไม่มีไฟล์ → 400', async () => {
      await expect(
        service.upload(undefined, { refType: 'DELIVERY', refId: 3 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('อัปโหลดสัญญา MA แล้วอัปเดต signed_file_url', async () => {
      attachmentModel.create.mockResolvedValue(
        attachmentRow({ refType: 'MA_CONTRACT', refId: 4, id: 20 }),
      );

      await runWithRequestContext(
        { userId: 4, ipAddress: null, userAgent: null, startedAt: Date.now() },
        async () => {
          await service.upload(pdf('สัญญาเซ็นแล้ว.pdf'), {
            refType: 'MA_CONTRACT',
            refId: 4,
          });
        },
      );

      expect(maContractModel.update).toHaveBeenCalledWith(
        expect.objectContaining({
          signedFileUrl: 'communication-logs/5/2026/09/abc.pdf',
        }),
        { where: { id: 4 } },
      );
    });
  });

  describe('findAll', () => {
    it('คืนรายการพร้อม downloadUrl', async () => {
      const rows = await service.findAll({ refType: 'COMMUNICATION_LOG', refId: 5 });

      expect(rows).toHaveLength(1);
      expect(rows[0].downloadUrl).toBe('/api/attachments/12/download');
      expect(rows[0].uploadedBy?.fullName).toBe('สมชาย ใจดี');
    });
  });

  describe('remove', () => {
    it('soft delete แถว ไม่เรียก storage ลบไฟล์', async () => {
      const row = attachmentRow();
      attachmentModel.findByPk.mockResolvedValue(row);

      await runWithRequestContext(
        { userId: 4, ipAddress: null, userAgent: null, startedAt: Date.now() },
        async () => {
          await service.remove(12);
        },
      );

      expect(row.destroy).toHaveBeenCalled();
      expect(storage.get).not.toHaveBeenCalled();
    });
  });
});
