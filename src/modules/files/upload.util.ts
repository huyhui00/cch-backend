import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

import { BadRequestException } from '@nestjs/common';

/**
 * ไฟล์ที่ multer แนบมากับ request (memory storage)
 *
 * ประกาศเองแทนการเพิ่ม `@types/multer` เพราะใช้แค่ไม่กี่ฟิลด์
 */
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

/**
 * ตัวเลือกของ FileInterceptor ที่ใช้ทั้งระบบ
 *
 * `defParamCharset: 'utf8'` สำคัญมาก — ค่าเริ่มต้นของ multer ถอดชื่อไฟล์เป็น latin1
 * ชื่อไฟล์ภาษาไทยอย่าง "ใบเสนอราคา.pdf" จะกลายเป็นตัวอักษรขยะ
 * ขนาดไฟล์ถูกตัดที่ชั้น multer ก่อนอ่านเข้าหน่วยความจำจนหมด
 */
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

/** ชื่อไฟล์เก็บได้ไม่เกิน 255 ตัวอักษร (ความยาวคอลัมน์ file_name) */
const MAX_FILE_NAME_LENGTH = 255;

/**
 * ตรวจไฟล์ที่อัปโหลดมา แล้วคืนชื่อไฟล์ที่สะอาดแล้ว — โยน 400 ภาษาไทยถ้าใช้ไม่ได้
 */
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

/**
 * ตัด path ที่อาจติดมากับชื่อไฟล์ และตัดความยาวให้ลงคอลัมน์ได้โดยยังเก็บนามสกุลไว้
 * ชื่อนี้ใช้แสดงผลและตอนดาวน์โหลดเท่านั้น ไม่ได้ใช้เป็น key ในที่เก็บ
 */
export function cleanFileName(original: string): string {
  const base = original.split(/[\\/]/).pop()?.trim() || 'file';

  if (base.length <= MAX_FILE_NAME_LENGTH) {
    return base;
  }

  const extension = extname(base);
  return base.slice(0, MAX_FILE_NAME_LENGTH - extension.length) + extension;
}

/**
 * key ในที่เก็บ — สร้างฝั่ง server เสมอ ไม่เอาชื่อไฟล์ของผู้ใช้มาเป็นส่วนของ path
 * เพื่อกันชื่อซ้ำทับกัน และกันชื่อไฟล์แปลก ๆ ที่พาหลุดออกนอกโฟลเดอร์
 */
export function buildStorageKey(scope: string, fileName: string, now = new Date()): string {
  const extension = extname(fileName).toLowerCase();
  const month = String(now.getMonth() + 1).padStart(2, '0');

  return `${scope}/${now.getFullYear()}/${month}/${randomUUID()}${extension}`;
}

/**
 * ค่า Content-Disposition ที่เบราว์เซอร์อ่านชื่อไฟล์ภาษาไทยได้ถูก
 * `filename` เป็นชื่อสำรองแบบ ASCII ส่วน `filename*` (RFC 5987) เป็นชื่อจริงแบบ UTF-8
 */
export function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
