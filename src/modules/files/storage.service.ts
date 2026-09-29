import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type StorageDriver = 'r2' | 'local';

/** ไฟล์ที่ถูกเก็บแล้วอยู่ที่ไหน — `key` คือค่าที่บันทึกลงคอลัมน์ `file_url` ของตาราง */
export interface StoredObject {
  key: string;
  driver: StorageDriver;
}

export interface StoredFileStream {
  stream: Readable;
  contentLength: number | null;
}

/**
 * คีย์ของไฟล์ที่เก็บบนดิสก์ในเครื่องขึ้นต้นด้วยค่านี้ ตอนดาวน์โหลดจึงรู้ว่าต้องอ่านจากที่ไหน
 * โดยไม่ต้องดูว่าตอนนี้ตั้งค่าไว้เป็นอะไร — ไฟล์ที่อัปโหลดระหว่างพัฒนาก่อนได้ key ของ R2
 * จึงยังเปิดได้หลังเปลี่ยนไปใช้ R2 แล้ว
 */
export const LOCAL_KEY_PREFIX = 'local:';

const DEFAULT_LOCAL_DIR = 'uploads';

/**
 * ที่เก็บไฟล์ของทั้งระบบ — Cloudflare R2 (S3-compatible) ตาม tech stack
 *
 * **bucket เป็นแบบ private เสมอ** ไม่คืน URL สาธารณะ ทุกการดาวน์โหลดวิ่งผ่าน API
 * ที่ตรวจสิทธิ์ก่อน เพราะไฟล์ในระบบนี้คือสัญญา ใบเสนอราคา และหลักฐานการติดต่อลูกค้า
 * ถ้าเปิดเป็นลิงก์สาธารณะ ใครได้ลิงก์ก็เปิดได้โดยไม่ต้องล็อกอิน
 *
 * **ดิสก์ในเครื่องใช้ได้เฉพาะตอนพัฒนา** (ประชุม 11 ก.ย. — พี่เลี้ยงให้ทำ R2 ไว้ก่อน แล้วค่อยส่ง
 * key ให้) ระหว่างยังไม่มี key ไฟล์จะถูกเก็บที่โฟลเดอร์ `uploads/` (อยู่ใน .gitignore แล้ว)
 * ส่วน production ที่ยังไม่ตั้งค่า R2 จะปฏิเสธการอัปโหลดด้วย 503 แทนที่จะเงียบ ๆ เก็บลงดิสก์
 * ของเซิร์ฟเวอร์ ซึ่งหายได้เมื่อย้ายเครื่องและไม่มีใครสำรองให้
 *
 * เลือกด้วย `STORAGE_DRIVER=r2|local` ถ้าไม่ระบุ: มี key ของ R2 ครบ = r2, ไม่มีและไม่ใช่
 * production = local
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private client: S3Client | null = null;

  constructor(private readonly config: ConfigService) {}

  /** ไดรเวอร์ที่ใช้เก็บไฟล์ใหม่ตอนนี้ — null = ยังเก็บไฟล์ไม่ได้ */
  activeDriver(): StorageDriver | null {
    const explicit = this.config.get<string>('STORAGE_DRIVER')?.trim().toLowerCase();

    if (explicit === 'r2' || explicit === 'local') {
      return explicit;
    }

    if (this.isR2Configured()) {
      return 'r2';
    }

    return this.config.get<string>('NODE_ENV') === 'production' ? null : 'local';
  }

  async put(key: string, body: Buffer, contentType: string | null): Promise<StoredObject> {
    const driver = this.activeDriver();

    if (driver === null) {
      throw new ServiceUnavailableException(
        'ระบบยังไม่ได้ตั้งค่าที่เก็บไฟล์ (Cloudflare R2) จึงอัปโหลดไม่ได้ — ติดต่อผู้ดูแลระบบ',
      );
    }

    if (driver === 'local') {
      const path = this.localPath(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);

      return { key: LOCAL_KEY_PREFIX + key, driver };
    }

    try {
      await this.s3().send(
        new PutObjectCommand({
          Bucket: this.bucket(),
          Key: key,
          Body: body,
          ContentType: contentType ?? undefined,
        }),
      );
    } catch (error) {
      this.logger.error(`อัปโหลดขึ้น R2 ไม่สำเร็จ key=${key}`, error as Error);
      throw new ServiceUnavailableException(
        'อัปโหลดไฟล์ไม่สำเร็จ — ที่เก็บไฟล์ไม่ตอบสนอง ลองใหม่อีกครั้ง',
      );
    }

    return { key, driver };
  }

  /** อ่านไฟล์ตาม key ที่บันทึกไว้ — ไดรเวอร์ตัดสินจาก key ไม่ใช่จากค่าตั้งปัจจุบัน */
  async get(storedKey: string): Promise<StoredFileStream> {
    if (storedKey.startsWith(LOCAL_KEY_PREFIX)) {
      const path = this.localPath(storedKey.slice(LOCAL_KEY_PREFIX.length));

      try {
        const info = await stat(path);
        return { stream: createReadStream(path), contentLength: info.size };
      } catch {
        throw new NotFoundException('ไม่พบไฟล์ในที่เก็บ — ไฟล์อาจถูกย้ายหรือลบไปแล้ว');
      }
    }

    try {
      const result = await this.s3().send(
        new GetObjectCommand({ Bucket: this.bucket(), Key: storedKey }),
      );

      return {
        stream: result.Body as Readable,
        contentLength: result.ContentLength ?? null,
      };
    } catch (error) {
      if ((error as { name?: string }).name === 'NoSuchKey') {
        throw new NotFoundException('ไม่พบไฟล์ในที่เก็บ — ไฟล์อาจถูกย้ายหรือลบไปแล้ว');
      }

      this.logger.error(`อ่านไฟล์จาก R2 ไม่สำเร็จ key=${storedKey}`, error as Error);
      throw new ServiceUnavailableException(
        'ดาวน์โหลดไฟล์ไม่สำเร็จ — ที่เก็บไฟล์ไม่ตอบสนอง ลองใหม่อีกครั้ง',
      );
    }
  }

  /**
   * ลบไฟล์ — ใช้กับของที่แทนที่ได้อย่างรูปโปรไฟล์เท่านั้น เอกสาร/หลักฐานไม่ลบไฟล์ (กฎ Phase 9)
   * ไม่พบไฟล์ = ถือว่าลบแล้ว
   */
  async delete(storedKey: string): Promise<void> {
    if (storedKey.startsWith(LOCAL_KEY_PREFIX)) {
      await rm(this.localPath(storedKey.slice(LOCAL_KEY_PREFIX.length)), { force: true });
      return;
    }

    await this.s3().send(new DeleteObjectCommand({ Bucket: this.bucket(), Key: storedKey }));
  }

  // ---- helpers -------------------------------------------------------------

  private isR2Configured(): boolean {
    const endpoint = this.config.get<string>('R2_ENDPOINT') ?? '';

    return (
      Boolean(this.config.get<string>('R2_ACCESS_KEY_ID')) &&
      Boolean(this.config.get<string>('R2_SECRET_ACCESS_KEY')) &&
      Boolean(this.config.get<string>('R2_BUCKET_NAME')) &&
      endpoint.length > 0 &&
      // ค่าตัวอย่างใน .env.example ยังไม่ใช่ endpoint จริง
      !endpoint.includes('<account-id>')
    );
  }

  private s3(): S3Client {
    if (!this.isR2Configured()) {
      throw new ServiceUnavailableException(
        'ระบบยังไม่ได้ตั้งค่า Cloudflare R2 ครบ (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_ENDPOINT)',
      );
    }

    this.client ??= new S3Client({
      region: this.config.get<string>('R2_REGION') || 'auto',
      endpoint: this.config.get<string>('R2_ENDPOINT'),
      credentials: {
        accessKeyId: this.config.get<string>('R2_ACCESS_KEY_ID') as string,
        secretAccessKey: this.config.get<string>('R2_SECRET_ACCESS_KEY') as string,
      },
    });

    return this.client;
  }

  private bucket(): string {
    return this.config.get<string>('R2_BUCKET_NAME') as string;
  }

  /**
   * path จริงบนดิสก์ — key ถูกสร้างฝั่ง server เสมอ ไม่ได้มาจาก client แต่ยังตรวจซ้ำว่า
   * ไม่หลุดออกนอกโฟลเดอร์ที่เก็บ กันกรณีมีคนแก้ค่าในฐานข้อมูลเป็น ../../ อะไรสักอย่าง
   */
  private localPath(key: string): string {
    const base = resolve(this.config.get<string>('LOCAL_STORAGE_DIR') || DEFAULT_LOCAL_DIR);
    const path = resolve(base, key);

    if (path !== base && !path.startsWith(base + sep)) {
      throw new InternalServerErrorException('ตำแหน่งไฟล์ไม่ถูกต้อง');
    }

    return path;
  }
}
