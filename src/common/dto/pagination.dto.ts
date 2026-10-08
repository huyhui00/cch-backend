import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export class PaginationDto {
  @ApiPropertyOptional({
    description: 'หน้าที่ต้องการ เริ่มที่ 1',
    minimum: 1,
    default: DEFAULT_PAGE,
    example: 1,
  })
  @IsOptional()
  @IsInt({ message: 'page ต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'page ต้องมีค่าตั้งแต่ 1 ขึ้นไป' })
  page: number = DEFAULT_PAGE;

  @ApiPropertyOptional({
    description: `จำนวนรายการต่อหน้า สูงสุด ${MAX_LIMIT}`,
    minimum: 1,
    maximum: MAX_LIMIT,
    default: DEFAULT_LIMIT,
    example: 20,
  })
  @IsOptional()
  @IsInt({ message: 'limit ต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'limit ต้องมีค่าตั้งแต่ 1 ขึ้นไป' })
  @Max(MAX_LIMIT, { message: `limit ต้องไม่เกิน ${MAX_LIMIT}` })
  limit: number = DEFAULT_LIMIT;

  @ApiPropertyOptional({
    description: 'คำค้นหา (ความหมายขึ้นกับแต่ละ module ว่าค้นจากคอลัมน์ใด)',
    maxLength: 255,
    example: 'บริษัท',
  })
  @IsOptional()
  @IsString({ message: 'search ต้องเป็นข้อความ' })
  @MaxLength(255, { message: 'search ยาวเกินกำหนด' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @ApiPropertyOptional({
    description:
      'ฟิลด์ที่ใช้เรียงลำดับ (camelCase ตาม JSON) แต่ละ service ต้อง whitelist ชื่อฟิลด์เองก่อนนำไปใช้',
    example: 'createdAt',
  })
  @IsOptional()
  @IsString({ message: 'sortBy ต้องเป็นข้อความ' })
  @MaxLength(64, { message: 'sortBy ยาวเกินกำหนด' })
  sortBy?: string;

  @ApiPropertyOptional({
    description: 'ทิศทางการเรียงลำดับ',
    enum: SortOrder,
    default: SortOrder.DESC,
    example: SortOrder.DESC,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsEnum(SortOrder, { message: 'sortOrder ต้องเป็น ASC หรือ DESC เท่านั้น' })
  sortOrder: SortOrder = SortOrder.DESC;

  get offset(): number {
    return (this.page - 1) * this.limit;
  }
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export function toPaginatedResult<T>(
  rows: T[],
  count: number,
  query: Pick<PaginationDto, 'page' | 'limit'>,
): PaginatedResult<T> {
  return {
    items: rows,
    total: count,
    page: query.page,
    limit: query.limit,
  };
}
