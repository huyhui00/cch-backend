import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from '@nestjs/common';

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true, // ส่ง field แปลกปลอมมา = 400
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    stopAtFirstError: true,
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
