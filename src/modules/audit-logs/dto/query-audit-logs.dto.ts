import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import { PaginationDto } from '../../../common/dto/pagination.dto';
import { AuditAction } from '../../../models';

// อ่านค่าดิบจาก obj ไม่ใช่ value — enableImplicitConversion แปลง 'false' เป็น true ไปก่อนแล้ว
function toBoolean(raw: unknown): unknown {
  return raw === 'true' ? true : raw === 'false' ? false : raw;
}

function splitList(raw: unknown): unknown {
  return typeof raw === 'string'
    ? raw
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    : raw;
}

export class QueryAuditLogsDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'กรองเฉพาะ action ที่ผู้ใช้คนนี้เป็นผู้กระทำ',
    example: 1,
  })
  @IsOptional()
  @IsInt({ message: 'userId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'userId ต้องมากกว่า 0' })
  userId?: number;

  @ApiPropertyOptional({
    description: 'ชื่อตารางในฐานข้อมูล (snake_case)',
    example: 'users',
    maxLength: 100,
  })
  @IsOptional()
  @IsString({ message: 'tableName ต้องเป็นข้อความ' })
  @MaxLength(100, { message: 'tableName ยาวเกินกำหนด' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  tableName?: string;

  @ApiPropertyOptional({
    description: 'id ของแถวที่ถูกกระทำ ใช้คู่กับ tableName เพื่อดูประวัติของข้อมูลชิ้นเดียว',
    example: 5,
  })
  @IsOptional()
  @IsInt({ message: 'recordId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'recordId ต้องมากกว่า 0' })
  recordId?: number;

  @ApiPropertyOptional({ enum: AuditAction, description: 'ชนิดของ action' })
  @IsOptional()
  @IsEnum(AuditAction, {
    message: 'action ต้องเป็น CREATE, UPDATE, DELETE, BULK_CREATE, BULK_UPDATE หรือ BULK_DELETE',
  })
  action?: AuditAction;

  @ApiPropertyOptional({
    description: 'ตั้งแต่วันที่ (รวมวันนั้นด้วย) รูปแบบ ISO 8601',
    example: '2026-09-01',
  })
  @IsOptional()
  @IsISO8601({}, { message: 'dateFrom ต้องเป็นวันที่รูปแบบ ISO 8601 เช่น 2026-09-01' })
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'ถึงวันที่ (รวมวันนั้นด้วย) รูปแบบ ISO 8601',
    example: '2026-09-30',
  })
  @IsOptional()
  @IsISO8601({}, { message: 'dateTo ต้องเป็นวันที่รูปแบบ ISO 8601 เช่น 2026-09-30' })
  dateTo?: string;

  @ApiPropertyOptional({
    description:
      'ตัดตารางที่ไม่ต้องการเห็นออก คั่นด้วยจุลภาค เช่น `notifications` ' +
      '(ยังบันทึกครบตาม BR-09 แค่ไม่แสดง) · ใช้คู่กับ tableName ไม่ได้ผลเพราะ tableName กรองแคบกว่าอยู่แล้ว',
    example: 'notifications',
  })
  @IsOptional()
  @Transform(({ obj }: { obj: Record<string, unknown> }) => splitList(obj.excludeTableNames))
  @IsArray({ message: 'excludeTableNames ต้องเป็นรายชื่อตารางคั่นด้วยจุลภาค' })
  @ArrayMaxSize(30, { message: 'excludeTableNames ระบุได้ไม่เกิน 30 ตาราง' })
  @IsString({ each: true, message: 'excludeTableNames ต้องเป็นข้อความ' })
  @Matches(/^[a-z_]{1,100}$/, { each: true, message: 'ชื่อตารางใน excludeTableNames ไม่ถูกต้อง' })
  excludeTableNames?: string[];

  @ApiPropertyOptional({
    description:
      '`true` = ซ่อนการเข้าสู่ระบบ / ต่ออายุ / ออกจากระบบ (แถว users ที่เปลี่ยนแค่เวลาเข้าสู่ระบบกับ token) ' +
      'ซึ่งเกิดทุกครั้งที่มีคนล็อกอินจนกลบประวัติการทำงานจริง — การแก้ข้อมูลผู้ใช้อื่น ๆ ยังแสดงตามปกติ',
    example: true,
  })
  @IsOptional()
  @Transform(({ obj }: { obj: Record<string, unknown> }) => toBoolean(obj.hideSessionEvents))
  @IsBoolean({ message: 'hideSessionEvents ต้องเป็น true หรือ false' })
  hideSessionEvents?: boolean;

  @ApiPropertyOptional({
    description:
      '`true` = ซ่อนสิ่งที่ระบบทำเองโดยไม่มีผู้กระทำ (งานตั้งเวลา เช่น ปรับประกัน/สัญญาเป็นหมดอายุ) ' +
      'ให้เหลือแต่การกระทำของผู้ใช้ — ไม่มีผลเมื่อส่ง userId มาด้วย',
    example: true,
  })
  @IsOptional()
  @Transform(({ obj }: { obj: Record<string, unknown> }) => toBoolean(obj.hideSystemEvents))
  @IsBoolean({ message: 'hideSystemEvents ต้องเป็น true หรือ false' })
  hideSystemEvents?: boolean;

  @ApiPropertyOptional({
    description:
      'โหลดต่อจากรายการก่อนหน้า (เลื่อนแล้วโหลดเพิ่ม) — ส่ง `nextCursor` ที่ได้จากผลลัพธ์ก่อนหน้า ' +
      'แล้ว page จะถูกเมิน · คืน `total: null` เพราะไม่นับจำนวนทั้งหมด · ใช้ได้เฉพาะลำดับเริ่มต้น (ใหม่ไปเก่า)',
    example: '1727580000000_3041',
  })
  @IsOptional()
  @IsString({ message: 'cursor ต้องเป็นข้อความ' })
  @MaxLength(40, { message: 'cursor ไม่ถูกต้อง' })
  cursor?: string;
}
