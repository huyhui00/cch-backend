import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { type PaginatedResult } from '../../common/dto/pagination.dto';
import { CreateMaPlanDto, QueryMaPlansDto, UpdateMaPlanDto } from './dto/ma-plan.dto';
import { MaPlanResponseDto } from './dto/ma.response';
import { MaPlansService } from './ma-plans.service';

/**
 * แผน MA — แม่แบบเนื้อหาที่ใช้ซ้ำได้ทุกโครงการ (BR-05)
 *
 * ไม่มีราคาในโมดูลนี้ ราคาอยู่ที่สัญญา ดู `ma-contracts.controller.ts`
 */
@ApiTags('ma-plans')
@ApiBearerAuth('access-token')
@Controller('ma-plans')
export class MaPlansController {
  constructor(private readonly plansService: MaPlansService) {}

  @Get()
  @RequirePermission('ma.view')
  @ApiOperation({
    summary: 'รายการแผน MA',
    description:
      'เรียงตาม sortOrder เป็นค่าเริ่มต้น พร้อมรายการบริการย่อยของแต่ละแผน ' +
      'ใช้ ?isActive=true เพื่อเอาเฉพาะแผนที่ยังเปิดให้เลือกตอนทำสัญญาใหม่',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [MaPlanResponseDto] })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  findAll(@Query() query: QueryMaPlansDto): Promise<PaginatedResult<MaPlanResponseDto>> {
    return this.plansService.findAll(query);
  }

  @Get(':id')
  @RequirePermission('ma.view')
  @ApiOperation({ summary: 'รายละเอียดแผน MA พร้อมรายการบริการย่อย' })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: MaPlanResponseDto })
  @ApiResponse({ status: 404, description: 'ไม่พบแผน MA นี้' })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<MaPlanResponseDto> {
    return this.plansService.findOne(id);
  }

  @Post()
  @RequirePermission('ma.create')
  @ApiOperation({
    summary: 'สร้างแผน MA',
    description:
      'ส่งรายการบริการย่อยมาพร้อมกันได้เลย — **ไม่มีฟิลด์ราคา** เพราะเนื้อหาแผน ' +
      'เหมือนกันทุกโครงการแต่ราคาต่างกัน ราคาไปกรอกตอนทำสัญญา (BR-05)',
  })
  @ApiResponse({ status: 201, description: 'สร้างแผนเรียบร้อย', type: MaPlanResponseDto })
  @ApiResponse({ status: 409, description: 'รหัสแผนซ้ำ' })
  async create(
    @Body() dto: CreateMaPlanDto,
  ): Promise<{ data: MaPlanResponseDto; message: string }> {
    return { data: await this.plansService.create(dto), message: 'สร้างแผน MA เรียบร้อย' };
  }

  @Patch(':id')
  @RequirePermission('ma.update')
  @ApiOperation({
    summary: 'แก้ไขแผน MA',
    description:
      'ส่ง items มาเมื่อไหร่ = แทนที่รายการบริการย่อยทั้งชุด ไม่ใช่เพิ่มต่อท้าย ' +
      'ไม่ส่งมา = ไม่แตะรายการเดิม',
  })
  @ApiResponse({ status: 200, description: 'แก้ไขเรียบร้อย', type: MaPlanResponseDto })
  @ApiResponse({ status: 404, description: 'ไม่พบแผน MA นี้' })
  @ApiResponse({ status: 409, description: 'รหัสแผนซ้ำ' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMaPlanDto,
  ): Promise<{ data: MaPlanResponseDto; message: string }> {
    return { data: await this.plansService.update(id, dto), message: 'แก้ไขแผน MA เรียบร้อย' };
  }

  @Delete(':id')
  @RequirePermission('ma.delete')
  @ApiOperation({
    summary: 'ลบแผน MA',
    description:
      'ลบได้เฉพาะแผนที่ยังไม่เคยถูกใช้ในสัญญาใด — แผนที่มีสัญญาอ้างอยู่ให้ปิดการใช้งาน ' +
      'ด้วย isActive = false แทน สัญญาเดิมจะยังอ่านเนื้อหาได้ตามปกติ',
  })
  @ApiResponse({ status: 200, description: 'ลบเรียบร้อย' })
  @ApiResponse({ status: 404, description: 'ไม่พบแผน MA นี้' })
  @ApiResponse({ status: 409, description: 'แผนนี้ถูกใช้ในสัญญาอยู่' })
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ data: null; message: string }> {
    await this.plansService.remove(id);
    return { data: null, message: 'ลบแผน MA เรียบร้อย' };
  }
}
