import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

import { BadRequestException } from '@nestjs/common';

export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * ขนาดไฟล์สูงสุดต่อไฟล์ (MB) — เป็นค่าคงที่ ไม่ได้อ่านจาก .env โดยเจตนา
 * ตัวเลือกของ FileInterceptor ถูกประเมินตอนโหลดไฟล์ controller ซึ่งเกิดก่อน ConfigModule
 * อ่าน .env ถ้าทำเป็นค่าตั้ง ค่าใน .env จะถูกเมินเงียบ ๆ แล้วคนตั้งจะเข้าใจผิดว่ามีผล
 * ใบเสนอราคา/สัญญาที่สแกนเป็น PDF ปกติไม่เกิน 5–10 MB
 */
export const MAX_UPLOAD_MB = 20;

export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export const UPLOAD_INTERCEPTOR_OPTIONS = {
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  defParamCharset: 'utf8',
};

/**
 * นามสกุลที่รับได้ — เอกสารสำนักงาน รูปภาพ และไฟล์บีบอัด
 *
 * ตรวจจากนามสกุล ไม่เชื่อ mimetype ที่ client ส่งมาอย่างเดียว เพราะปลอมได้ง่าย
 * ตัดไฟล์ที่รันได้ (.exe, .bat, .js, .html ฯลฯ) ทิ้งทั้งหมด เพราะไฟล์ถูกดาวน์โหลดกลับไป
 * เปิดบนเครื่องพนักงาน ถ้าเก็บไฟล์รันได้ไว้ ระบบนี้จะกลายเป็นทางส่งมัลแวร์ภายในบริษัท
 */
export const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.heic',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.odt',
  '.ods',
  '.txt',
  '.csv',
  '.zip',
  '.rar',
  '.7z',
]);

const MAX_FILE_NAME_LENGTH = 255;

export function assertUploadable(file: UploadedFileLike | undefined): string {
  if (!file) {
    throw new BadRequestException('กรุณาแนบไฟล์ (ฟิลด์ file)');
  }

  if (file.size === 0) {
    throw new BadRequestException('ไฟล์ว่างเปล่า');
  }

  const name = cleanFileName(file.originalname);
  const extension = extname(name).toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new BadRequestException(
      `ไม่รับไฟล์ประเภท ${extension || '(ไม่มีนามสกุล)'} — รับได้เฉพาะเอกสาร รูปภาพ และไฟล์บีบอัด`,
    );
  }

  return name;
}

export function cleanFileName(original: string): string {
  const base = original.split(/[\\/]/).pop()?.trim() || 'file';

  if (base.length <= MAX_FILE_NAME_LENGTH) {
    return base;
  }

  const extension = extname(base);
  return base.slice(0, MAX_FILE_NAME_LENGTH - extension.length) + extension;
}

export function buildStorageKey(scope: string, fileName: string, now = new Date()): string {
  const extension = extname(fileName).toLowerCase();
  const month = String(now.getMonth() + 1).padStart(2, '0');

  return `${scope}/${now.getFullYear()}/${month}/${randomUUID()}${extension}`;
}

export function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
