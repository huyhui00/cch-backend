import { basename, extname } from 'node:path';

import { BadRequestException } from '@nestjs/common';

import { LOCAL_KEY_PREFIX } from '../files/storage.service';
import type { UploadedFileLike } from '../files/upload.util';

/** ค่าคงที่ด้วยเหตุผลเดียวกับ MAX_UPLOAD_MB — ตัวเลือกของ FileInterceptor ถูกประเมินก่อนอ่าน .env */
export const AVATAR_MAX_MB = 2;

export const AVATAR_INTERCEPTOR_OPTIONS = {
  limits: { fileSize: AVATAR_MAX_MB * 1024 * 1024, files: 1 },
  defParamCharset: 'utf8',
};

const AVATAR_TYPES: ReadonlyMap<string, { extensions: readonly string[]; contentType: string }> =
  new Map([
    ['image/jpeg', { extensions: ['.jpg', '.jpeg'], contentType: 'image/jpeg' }],
    ['image/png', { extensions: ['.png'], contentType: 'image/png' }],
    ['image/webp', { extensions: ['.webp'], contentType: 'image/webp' }],
  ]);

/** ตรวจทั้ง mimetype และนามสกุลให้ตรงกัน — คืนนามสกุลที่ใช้ตั้งชื่อไฟล์ในที่เก็บ */
export function assertAvatarFile(file: UploadedFileLike | undefined): string {
  if (!file) {
    throw new BadRequestException('กรุณาแนบรูปภาพ (ฟิลด์ file)');
  }

  if (file.size === 0) {
    throw new BadRequestException('ไฟล์ว่างเปล่า');
  }

  const type = AVATAR_TYPES.get(file.mimetype);
  const extension = extname(file.originalname).toLowerCase();

  if (!type || !type.extensions.includes(extension)) {
    throw new BadRequestException('รูปโปรไฟล์ต้องเป็นไฟล์ JPG, PNG หรือ WEBP เท่านั้น');
  }

  return extension;
}

export function avatarScope(userId: number): string {
  return `users/${userId}/avatar`;
}

/**
 * key ในคอลัมน์ avatar_url เป็นรูปที่อัปโหลดผ่านระบบของผู้ใช้คนนี้จริงไหม
 * ใช้กั้นเส้นดาวน์โหลด — ไม่งั้นคนที่แก้ avatarUrl ผ่าน PUT /users/:id ได้ จะชี้ไปอ่านไฟล์อื่นในที่เก็บได้
 */
export function isOwnAvatarKey(userId: number, key: string | null): key is string {
  if (!key) {
    return false;
  }

  const bare = key.startsWith(LOCAL_KEY_PREFIX) ? key.slice(LOCAL_KEY_PREFIX.length) : key;
  return bare.startsWith(avatarScope(userId) + '/') && !bare.includes('..');
}

export function avatarContentType(key: string): string {
  const extension = extname(key).toLowerCase();

  for (const type of AVATAR_TYPES.values()) {
    if (type.extensions.includes(extension)) {
      return type.contentType;
    }
  }

  return 'application/octet-stream';
}

/**
 * ค่า avatarUrl ที่ส่งออกไป — รูปที่อัปโหลดผ่านระบบคืนเป็น path ของ API (ดึงพร้อม Authorization header)
 * ไม่คืน key ของที่เก็บ (กฎ Phase 9) · ค่าเก่าที่คนพิมพ์เป็น URL เองคืนตามเดิม
 * `?v=` เปลี่ยนทุกครั้งที่อัปโหลดรูปใหม่ — หน้าจอที่ cache blob ตาม URL จะได้รู้ว่าต้องโหลดใหม่
 */
export function avatarUrlFor(user: { id: number; avatarUrl: string | null }): string | null {
  if (!user.avatarUrl) {
    return null;
  }

  if (!isOwnAvatarKey(user.id, user.avatarUrl)) {
    return user.avatarUrl;
  }

  const version = basename(user.avatarUrl, extname(user.avatarUrl));
  return `/api/users/${user.id}/avatar?v=${encodeURIComponent(version)}`;
}
