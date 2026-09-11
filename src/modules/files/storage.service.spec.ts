/// <reference types="jest" />
// TypeScript 6 ไม่ดึง @types/jest เข้ามาให้อัตโนมัติ ต้องอ้างถึงตรงนี้เหมือน spec ตัวอื่น

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { LOCAL_KEY_PREFIX, StorageService } from './storage.service';

/**
 * ที่เก็บไฟล์ (Phase 9)
 *
 * กฎที่เทสต์ชุดนี้ปักหมุดไว้
 *   1. production ที่ไม่มี key ของ R2 ต้องปฏิเสธ ไม่แอบเก็บลงดิสก์ของเซิร์ฟเวอร์
 *   2. ไฟล์ในเครื่องมี key ขึ้นต้นด้วย `local:` จึงยังเปิดได้หลังเปลี่ยนไปใช้ R2
 *   3. key ที่ถูกแก้ในฐานข้อมูลให้ชี้ออกนอกโฟลเดอร์ต้องถูกปฏิเสธ
 */

function configWith(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

const R2_VALUES = {
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_NAME: 'cch-files',
  R2_ENDPOINT: 'https://abc123.r2.cloudflarestorage.com',
};

async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}

describe('StorageService', () => {
  describe('เลือกไดรเวอร์', () => {
    it('มี key ของ R2 ครบ → r2', () => {
      expect(new StorageService(configWith(R2_VALUES)).activeDriver()).toBe('r2');
    });

    it('ยังไม่มี key และไม่ใช่ production → เก็บในเครื่อง', () => {
      expect(new StorageService(configWith({ NODE_ENV: 'development' })).activeDriver()).toBe(
        'local',
      );
    });

    it('endpoint ยังเป็นค่าตัวอย่างใน .env.example → ถือว่ายังไม่ได้ตั้ง', () => {
      const service = new StorageService(
        configWith({ ...R2_VALUES, R2_ENDPOINT: 'https://<account-id>.r2.cloudflarestorage.com' }),
      );

      expect(service.activeDriver()).toBe('local');
    });

    it('production ที่ไม่มี key ของ R2 → อัปโหลดไม่ได้ (503) ไม่แอบเก็บลงดิสก์', async () => {
      const service = new StorageService(configWith({ NODE_ENV: 'production' }));

      expect(service.activeDriver()).toBeNull();
      await expect(service.put('projects/1/a.pdf', Buffer.from('x'), null)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('STORAGE_DRIVER ที่ระบุเองชนะการเลือกอัตโนมัติ', () => {
      const service = new StorageService(configWith({ ...R2_VALUES, STORAGE_DRIVER: 'local' }));

      expect(service.activeDriver()).toBe('local');
    });
  });

  describe('เก็บในเครื่อง', () => {
    let dir: string;
    let service: StorageService;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'cch-storage-spec-'));
      service = new StorageService(configWith({ NODE_ENV: 'development', LOCAL_STORAGE_DIR: dir }));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('เก็บแล้วอ่านกลับได้ครบ และ key ขึ้นต้นด้วย local:', async () => {
      const stored = await service.put('projects/3/2026/09/file.txt', Buffer.from('สวัสดี'), null);

      expect(stored).toEqual({
        key: `${LOCAL_KEY_PREFIX}projects/3/2026/09/file.txt`,
        driver: 'local',
      });
      expect(await readFile(join(dir, 'projects/3/2026/09/file.txt'), 'utf8')).toBe('สวัสดี');

      const file = await service.get(stored.key);
      expect(await readAll(file.stream)).toBe('สวัสดี');
      expect(file.contentLength).toBe(Buffer.byteLength('สวัสดี'));
    });

    it('ไฟล์ไม่อยู่แล้ว → 404 ภาษาไทย ไม่ใช่ error ดิบของระบบไฟล์', async () => {
      await expect(service.get(`${LOCAL_KEY_PREFIX}projects/3/missing.pdf`)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('key ที่ชี้ออกนอกโฟลเดอร์ที่เก็บถูกปฏิเสธ', async () => {
      await expect(service.get(`${LOCAL_KEY_PREFIX}../../etc/passwd`)).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });

    it('ไฟล์ในเครื่องยังเปิดได้หลังเปลี่ยนไปใช้ R2 — ไดรเวอร์ตัดสินจาก key', async () => {
      const stored = await service.put('projects/3/old.txt', Buffer.from('เก่า'), null);
      const afterSwitch = new StorageService(configWith({ ...R2_VALUES, LOCAL_STORAGE_DIR: dir }));

      expect(await readAll((await afterSwitch.get(stored.key)).stream)).toBe('เก่า');
    });
  });

  describe('R2', () => {
    beforeEach(() => {
      // เคสที่ R2 ไม่ตอบสนองตั้งใจให้ service log error ไม่ต้องพิมพ์ลงผลของเทสต์
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('อัปโหลดขึ้น bucket ที่ตั้งไว้ด้วย key เดิม ไม่เติม prefix', async () => {
      const send = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
      const service = new StorageService(configWith(R2_VALUES));

      const stored = await service.put('projects/3/a.pdf', Buffer.from('pdf'), 'application/pdf');

      expect(stored).toEqual({ key: 'projects/3/a.pdf', driver: 'r2' });
      const command = send.mock.calls[0][0] as PutObjectCommand;
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input).toEqual(
        expect.objectContaining({
          Bucket: 'cch-files',
          Key: 'projects/3/a.pdf',
          ContentType: 'application/pdf',
        }),
      );
    });

    it('R2 ไม่ตอบสนอง → 503 ภาษาไทย', async () => {
      jest.spyOn(S3Client.prototype, 'send').mockRejectedValue(new Error('timeout') as never);
      const service = new StorageService(configWith(R2_VALUES));

      await expect(service.put('projects/3/a.pdf', Buffer.from('x'), null)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('ไม่พบไฟล์บน R2 → 404', async () => {
      jest
        .spyOn(S3Client.prototype, 'send')
        .mockRejectedValue(Object.assign(new Error('missing'), { name: 'NoSuchKey' }) as never);
      const service = new StorageService(configWith(R2_VALUES));

      await expect(service.get('projects/3/a.pdf')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
