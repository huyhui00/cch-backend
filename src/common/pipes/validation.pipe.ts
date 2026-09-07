import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from '@nestjs/common';

/**
 * ValidationPipe ตัวเดียวที่ใช้ทั้งระบบ (ผูกเป็น global ใน main.ts)
 * แยกออกมาเป็น factory เพื่อให้ test ใช้ค่าเดียวกับ runtime จริง
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true, // ตัด field ที่ไม่ได้ประกาศใน DTO ทิ้ง
    forbidNonWhitelisted: true, // ส่ง field แปลกปลอมมา = 400
    transform: true, // แปลง payload เป็น instance ของ DTO
    transformOptions: { enableImplicitConversion: true },
    stopAtFirstError: true,
    // ข้อความที่ส่งกลับผู้ใช้ต้องเป็นภาษาไทยเสมอ (CLAUDE.md 6.5)
    exceptionFactory: (errors: ValidationError[]) =>
      new BadRequestException(firstThaiMessage(errors)),
  });
}

/**
 * ดึงข้อความ error แรกจาก class-validator
 * DTO ของเราเขียน message เป็นไทยอยู่แล้ว เหลือแต่ข้อความที่ ValidationPipe
 * สร้างเองตอน whitelist ปฏิเสธ field แปลกปลอม ซึ่งเป็นอังกฤษ ต้องแปลงเป็นไทย
 */
export function firstThaiMessage(errors: ValidationError[]): string {
  for (const error of errors) {
    for (const message of Object.values(error.constraints ?? {})) {
      const unknownField = /^property (.+) should not exist$/.exec(message);
      if (unknownField) {
        return `ไม่รู้จักฟิลด์ "${unknownField[1]}"`;
      }
      return message;
    }

    if (error.children && error.children.length > 0) {
      return firstThaiMessage(error.children);
    }
  }

  return 'ข้อมูลที่ส่งมาไม่ถูกต้อง';
}
