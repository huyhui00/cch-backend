import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';

import { ResolutionResult } from '../../../models';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * บันทึกผลการแก้ปัญหาหนึ่งรอบ (BR-03)
 *
 * ไม่มี `round` ให้กรอกโดยเจตนา — ระบบนับจากรอบที่มีอยู่แล้วบวกหนึ่งเสมอ
 * ถ้าเปิดให้กรอกเอง สองคนที่กดพร้อมกันจะส่ง round เดียวกันมา แล้วชน unique index
 * และที่แย่กว่าคือคนกรอกผิดตัวเลขเองได้ ทำให้ลำดับประวัติการแก้เพี้ยน
 */
export class CreateResolutionDto {
  @ApiProperty({
    enum: ResolutionResult,
    description: 'ผลของรอบนี้ — PARTIAL หรือ FAILED ก็บันทึกได้ ไม่ต้องรอให้สำเร็จก่อน',
    example: ResolutionResult.SUCCESS,
  })
  @IsEnum(ResolutionResult, { message: 'ผลการแก้ไขต้องเป็น SUCCESS, PARTIAL หรือ FAILED' })
  result: ResolutionResult;

  @ApiProperty({
    description: 'สิ่งที่ทำไปในรอบนี้',
    example: 'แก้ query ที่ join ผิดตารางจนดึงข้อมูลซ้ำ แล้วเพิ่ม index ให้คอลัมน์วันที่',
  })
  @IsString({ message: 'รายละเอียดการแก้ไขต้องเป็นข้อความ' })
  @IsNotEmpty({ message: 'กรุณากรอกรายละเอียดการแก้ไข' })
  @Transform(trim)
  detail: string;

  @ApiProperty({
    description: 'เวลาที่แก้เสร็จจริง บันทึกย้อนหลังได้ แต่บันทึกล่วงหน้าไม่ได้',
    example: '2026-09-09T07:30:00.000Z',
  })
  @IsISO8601({ strict: false }, { message: 'resolvedAt ต้องเป็นวันที่เวลาตามรูปแบบ ISO 8601' })
  resolvedAt: string;

  @ApiPropertyOptional({
    description: 'สาเหตุที่แท้จริง — กรอกไว้จะช่วยตอนปัญหาเดิมกลับมาในรอบถัดไป',
    example: 'query เดิมไม่ได้กรองสาขา ทำให้ข้อมูลข้ามสาขาปนกัน',
  })
  @IsOptional()
  @IsString({ message: 'สาเหตุต้องเป็นข้อความ' })
  @Transform(trimToNull)
  rootCause?: string | null;

  @ApiPropertyOptional({
    description: 'พนักงานที่ลงมือแก้รอบนี้ ไม่ส่งมาถือว่าคนบันทึกเป็นคนแก้',
    example: 4,
  })
  @IsOptional()
  @IsInt({ message: 'resolvedByUserId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'resolvedByUserId ต้องมากกว่า 0' })
  resolvedByUserId?: number | null;

  @ApiPropertyOptional({
    description: 'เวลาที่เริ่มลงมือรอบนี้ ต้องไม่อยู่หลัง resolvedAt',
    example: '2026-09-09T04:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601({ strict: false }, { message: 'startedAt ต้องเป็นวันที่เวลาตามรูปแบบ ISO 8601' })
  startedAt?: string | null;

  @ApiPropertyOptional({
    description: 'ชั่วโมงที่ใช้ไปในรอบนี้ ส่งเป็นสตริงตัวเลข',
    example: '3.50',
  })
  @IsOptional()
  @IsNumberString({ no_symbols: false }, { message: 'ชั่วโมงที่ใช้ต้องเป็นตัวเลข' })
  hoursSpent?: string | null;

  @ApiPropertyOptional({
    description:
      'ค่าบริการส่วนเกินโควตา ส่งเป็นสตริงตัวเลข — ระบบบอกได้แค่ว่าเกินโควตาหรือไม่ ' +
      'ส่วนจำนวนเงินต้องกรอกเอง เพราะยังไม่มีที่เก็บอัตราค่าบริการส่วนเกินในระบบ',
    example: '1500.00',
  })
  @IsOptional()
  @IsNumberString({ no_symbols: false }, { message: 'ค่าบริการส่วนเกินต้องเป็นตัวเลข' })
  extraCharge?: string | null;
}
