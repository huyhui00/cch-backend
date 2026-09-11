import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { type PaginatedResult } from '../../common/dto/pagination.dto';
import {
  CreateWarrantyDto,
  QueryExpiringWarrantiesDto,
  QueryWarrantiesDto,
  UpdateWarrantyDto,
} from './dto/warranty.dto';
import { WarrantyResponseDto } from './dto/warranty.response';
import { WarrantiesService } from './warranties.service';

/**
 * การรับประกัน (BR-06)
 *
 * การออกประกันอยู่ใต้เส้นทางของ "การส่งมอบ" ไม่ใช่ใต้โครงการ เพราะระยะประกัน
 * นับจากวันส่งมอบ การผูกกับใบส่งมอบตั้งแต่ระดับ URL ทำให้ไม่มีทางออกประกัน
 * โดยไม่มีวันตั้งต้นที่ตรวจสอบได้
 */
@ApiTags('warranties')
@ApiBearerAuth('access-token')
@Controller()
export class WarrantiesController {
  constructor(private readonly warrantiesService: WarrantiesService) {}

  @Get('warranties/expiring')
  @RequirePermission('warranty.view')
  @ApiOperation({
    summary: 'ประกันที่ใกล้หมดอายุ',
    description:
      'ดูล่วงหน้าตามจำนวนวันที่ระบุ (ค่าเริ่มต้น 30 วัน) เรียงจากใกล้หมดที่สุดขึ้นก่อน ' +
      'ไม่รวมประกันที่หมดอายุไปแล้วและที่ถูกยกเลิกเป็น VOID ' +
      'เป็นตัวป้อนให้ notification rule แบบ WARRANTY_EXPIRING ใน Phase 11',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [WarrantyResponseDto] })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  findExpiring(
    @Query() query: QueryExpiringWarrantiesDto,
  ): Promise<PaginatedResult<WarrantyResponseDto>> {
    return this.warrantiesService.findExpiring(query);
  }

  @Get('projects/:projectId/warranties')
  @RequirePermission('warranty.view')
  @ApiOperation({
    summary: 'ประกันทั้งหมดของโครงการ',
    description:
      'โครงการหนึ่งมีประกันได้หลายใบ เพราะส่งมอบได้หลายรอบ และแต่ละรอบออกประกันแยกกัน ' +
      'ให้ดูที่ isCurrentlyActive ว่าใบไหนยังคุ้มครองอยู่จริง ไม่ใช่ดูที่ status',
  })
  @ApiParam({ name: 'projectId', description: 'id ของโครงการ', example: 1 })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [WarrantyResponseDto] })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลโครงการ' })
  findAllByProject(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Query() query: QueryWarrantiesDto,
  ): Promise<PaginatedResult<WarrantyResponseDto>> {
    return this.warrantiesService.findAllByProject(projectId, query);
  }

  @Get('warranties/:id')
  @RequirePermission('warranty.view')
  @ApiOperation({ summary: 'รายละเอียดการรับประกัน' })
  @ApiParam({ name: 'id', description: 'id ของใบประกัน', example: 4 })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: WarrantyResponseDto })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลการรับประกัน' })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<WarrantyResponseDto> {
    return this.warrantiesService.findOne(id);
  }

  @Post('deliveries/:deliveryId/warranties')
  @RequirePermission('warranty.create')
  @ApiOperation({
    summary: 'ออกประกันจากการส่งมอบ',
    description:
      'startDate เท่ากับวันส่งมอบเสมอ ส่งมาเองไม่ได้ และ endDate = startDate + durationMonth ' +
      'โดยหนีบวันสิ้นเดือนให้ (31 ม.ค. + 1 เดือน = 28 ก.พ. ไม่ใช่ 3 มี.ค.) ' +
      'ออกได้หลายใบต่อการส่งมอบหนึ่งครั้งถ้าระยะต่างกัน เช่นฮาร์ดแวร์ 12 เดือน ซอฟต์แวร์ 6 เดือน ' +
      'ระบุขอบเขตที่ครอบคลุมไว้ที่ scopeNote เพื่อใช้ตัดสินตอนเปิด ticket (BR-07) ' +
      '**ออกได้เฉพาะการส่งมอบที่ลูกค้ายอมรับแล้ว (acceptanceStatus = ACCEPTED)** ' +
      'ประกันคุ้มครองทั้งโครงการ การส่งมอบเป็นแค่ตัวกำหนดวันเริ่ม',
  })
  @ApiParam({ name: 'deliveryId', description: 'id ของใบส่งมอบ', example: 5 })
  @ApiResponse({ status: 201, description: 'ออกประกันเรียบร้อย', type: WarrantyResponseDto })
  @ApiResponse({ status: 400, description: 'ข้อมูลไม่ถูกต้อง' })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลการส่งมอบ' })
  @ApiResponse({
    status: 409,
    description: 'การส่งมอบนี้ยังไม่ได้รับการยอมรับจากลูกค้า หรือมีประกันระยะเท่ากันอยู่แล้ว',
  })
  async create(
    @Param('deliveryId', ParseIntPipe) deliveryId: number,
    @Body() dto: CreateWarrantyDto,
  ): Promise<{ data: WarrantyResponseDto; message: string }> {
    return {
      data: await this.warrantiesService.create(deliveryId, dto),
      message: 'ออกประกันเรียบร้อย',
    };
  }

  @Put('warranties/:id')
  @RequirePermission('warranty.update')
  @ApiOperation({
    summary: 'แก้ไขการรับประกัน',
    description:
      'แก้ durationMonth แล้ว endDate ถูกคำนวณใหม่จากวันส่งมอบเดิมให้เอง ' +
      'startDate แก้ที่นี่ไม่ได้ตาม BR-06 ถ้าวันส่งมอบผิดให้ไปแก้ที่ใบส่งมอบ ' +
      'ระบบจะขยับประกันตามให้ ส่วน status ใช้สำหรับยกเลิกเป็น VOID เท่านั้น',
  })
  @ApiParam({ name: 'id', description: 'id ของใบประกัน', example: 4 })
  @ApiResponse({ status: 200, description: 'บันทึกการแก้ไขเรียบร้อย', type: WarrantyResponseDto })
  @ApiResponse({ status: 400, description: 'ข้อมูลไม่ถูกต้อง' })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลการรับประกัน' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWarrantyDto,
  ): Promise<{ data: WarrantyResponseDto; message: string }> {
    return {
      data: await this.warrantiesService.update(id, dto),
      message: 'บันทึกการแก้ไขเรียบร้อย',
    };
  }
}
