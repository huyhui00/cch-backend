/// <reference types="jest" />
// TypeScript 6 ไม่ดึง @types/jest เข้ามาให้อัตโนมัติ ต้องอ้างถึงตรงนี้เหมือน spec ตัวอื่น

import { BadRequestException } from '@nestjs/common';

import {
  assertUploadable,
  buildStorageKey,
  cleanFileName,
  contentDisposition,
  type UploadedFileLike,
} from './upload.util';

function fileNamed(originalname: string, size = 10): UploadedFileLike {
  return { originalname, mimetype: 'application/octet-stream', size, buffer: Buffer.alloc(size) };
}

describe('upload.util', () => {
  describe('assertUploadable', () => {
    it('ไม่แนบไฟล์ → 400', () => {
      expect(() => assertUploadable(undefined)).toThrow(BadRequestException);
    });

    it('ไฟล์ว่าง → 400', () => {
      expect(() => assertUploadable(fileNamed('a.pdf', 0))).toThrow(BadRequestException);
    });

    it.each(['setup.exe', 'run.bat', 'page.html', 'script.js', 'noextension'])(
      'ปฏิเสธไฟล์ที่รันได้หรือไม่มีนามสกุล: %s',
      (name) => {
        expect(() => assertUploadable(fileNamed(name))).toThrow(BadRequestException);
      },
    );

    it.each(['ใบเสนอราคา.pdf', 'สแกนสัญญา.JPG', 'แผนงาน.xlsx', 'scope.docx'])(
      'รับเอกสารและรูปภาพ (ไม่สนตัวพิมพ์ของนามสกุล): %s',
      (name) => {
        expect(assertUploadable(fileNamed(name))).toBe(name);
      },
    );
  });

  it('cleanFileName ตัด path ที่ติดมา แต่ยังเก็บชื่อภาษาไทย', () => {
    expect(cleanFileName('C:\\Users\\a\\ใบเสนอราคา.pdf')).toBe('ใบเสนอราคา.pdf');
    expect(cleanFileName('../../ใบแจ้งหนี้.pdf')).toBe('ใบแจ้งหนี้.pdf');
  });

  it('cleanFileName ตัดชื่อยาวให้ลงคอลัมน์ได้ โดยนามสกุลยังอยู่', () => {
    const cleaned = cleanFileName('ก'.repeat(400) + '.pdf');

    expect(cleaned.length).toBe(255);
    expect(cleaned.endsWith('.pdf')).toBe(true);
  });

  it('buildStorageKey ไม่เอาชื่อไฟล์ของผู้ใช้มาเป็น path — ใช้แค่นามสกุล', () => {
    const key = buildStorageKey('projects/3', '../../ใบเสนอราคา.PDF', new Date(2026, 8, 11));

    expect(key).toMatch(/^projects\/3\/2026\/09\/[0-9a-f-]{36}\.pdf$/);
  });

  it('contentDisposition ส่งชื่อภาษาไทยผ่าน filename* และมีชื่อสำรองแบบ ASCII', () => {
    const header = contentDisposition('ใบเสนอราคา "v2".pdf');

    expect(header).toContain(`filename*=UTF-8''${encodeURIComponent('ใบเสนอราคา "v2".pdf')}`);
    expect(header).toMatch(/filename="[\x20-\x7e]+"/);
    expect(header).not.toMatch(/filename="[^"]*"[^;]*"/);
  });
});
