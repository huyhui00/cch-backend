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
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { type PaginatedResult } from '../../common/dto/pagination.dto';
import {
  CompleteFollowUpDto,
  CreateFollowUpDto,
  QueryFollowUpsDto,
  UpdateFollowUpDto,
} from './dto/follow-up.dto';
import { CompletedFollowUpResponseDto, FollowUpResponseDto } from './dto/follow-up.response';
import { FollowUpsService } from './follow-ups.service';

@ApiTags('follow-ups')
@ApiBearerAuth('access-token')
@Controller('follow-ups')
export class FollowUpsController {
  constructor(private readonly followUpsService: FollowUpsService) {}

  @Get()
  @RequirePermission('followup.view')
  @ApiOperation({
    summary: 'รายการงานติดตาม',
    description:
      'เรียงตามวันครบกำหนดจากเก่าไปใหม่เป็นค่าเริ่มต้น — ของที่ค้างนานที่สุดอยู่บนสุด ' +
      'กรองได้ด้วย customerId, assignedUserId, status, overdue และช่วง dueFrom/dueTo',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [FollowUpResponseDto] })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  findAll(@Query() query: QueryFollowUpsDto): Promise<PaginatedResult<FollowUpResponseDto>> {
    return this.followUpsService.findAll(query);
  }

  @Get(':id')
  @RequirePermission('followup.view')
  @ApiOperation({ summary: 'รายละเอียดงานติดตาม' })
  @ApiParam({ name: 'id', description: 'id ของงานติดตาม', example: 12 })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: FollowUpResponseDto })
  @ApiResponse({ status: 404, description: 'ไม่พบงานติดตามนี้' })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<FollowUpResponseDto> {
    return this.followUpsService.findOne(id);
  }

  @Post()
  @RequirePermission('followup.create')
  @ApiOperation({
    summary: 'สร้างงานติดตาม',
    description:
      'เริ่มที่สถานะ PLANNED เสมอ แม้ลงวันครบกำหนดย้อนหลัง เพราะ OVERDUE เป็นค่าที่ ' +
      'ระบบคำนวณจากวันที่ ไม่ใช่ค่าที่ตั้งเอง — ไม่มีฟิลด์ channel ช่องทางการติดต่อ ' +
      'เป็นของบันทึกการติดต่อ (BR-02)',
  })
  @ApiResponse({ status: 201, description: 'สร้างงานติดตามเรียบร้อย', type: FollowUpResponseDto })
  @ApiResponse({ status: 400, description: 'ผู้รับผิดชอบไม่อยู่ในสถานะใช้งาน' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลลูกค้า' })
  async create(
    @Body() dto: CreateFollowUpDto,
  ): Promise<{ data: FollowUpResponseDto; message: string }> {
    return { data: await this.followUpsService.create(dto), message: 'สร้างงานติดตามเรียบร้อย' };
  }

  @Patch(':id')
  @RequirePermission('followup.update')
  @ApiOperation({
    summary: 'แก้ไขงานติดตาม',
    description:
      'ย้ายลูกค้าไม่ได้ — ผูกผิดรายให้ยกเลิกแล้วสร้างใหม่ ' +
      'สถานะเปลี่ยนไปไหนก็ได้ไม่บังคับลำดับ เป็น DONE แล้วระบบใส่ completedAt ให้ ' +
      'ถอยออกแล้วล้างค่า',
  })
  @ApiParam({ name: 'id', description: 'id ของงานติดตาม', example: 12 })
  @ApiResponse({ status: 200, description: 'แก้ไขเรียบร้อย', type: FollowUpResponseDto })
  @ApiResponse({ status: 400, description: 'ตั้งสถานะ OVERDUE เอง หรือผู้รับผิดชอบใช้งานไม่ได้' })
  @ApiResponse({ status: 404, description: 'ไม่พบงานติดตามนี้' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFollowUpDto,
  ): Promise<{ data: FollowUpResponseDto; message: string }> {
    return {
      data: await this.followUpsService.update(id, dto),
      message: 'แก้ไขงานติดตามเรียบร้อย',
    };
  }

  @Patch(':id/complete')
  @RequirePermission('followup.complete')
  @ApiOperation({
    summary: 'ปิดงานติดตาม',
    description:
      'ทางลัดของการตั้งสถานะเป็น DONE แยกเป็นสิทธิ์ followup.complete ต่างหาก ' +
      'เพื่อให้ทีมที่อยากให้พนักงานปิดงานของตัวเองได้แต่ไม่ให้แก้เนื้อหางาน กั้นได้จริง — ' +
      '**การปิดงานไม่ไปอัปเดต customers.lastContactedAt** ถ้าติดต่อลูกค้าจริงแล้ว ' +
      'ให้บันทึกการติดต่อแยกอีกใบที่ POST /api/communication-logs · ' +
      'ส่ง nextDueDate มา = นัดครั้งถัดไป (M7-02) ระบบสร้างงานใหม่ให้ในทรานแซกชันเดียวกัน ' +
      'คืนมาที่ nextFollowUp',
  })
  @ApiParam({ name: 'id', description: 'id ของงานติดตาม', example: 12 })
  @ApiResponse({
    status: 200,
    description: 'ปิดงานเรียบร้อย',
    type: CompletedFollowUpResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'งานที่ยกเลิกแล้วปิดงานไม่ได้ / วันครั้งถัดไปอยู่ในอดีต / ส่ง nextTitle โดยไม่มี nextDueDate',
  })
  @ApiResponse({ status: 404, description: 'ไม่พบงานติดตามนี้' })
  @ApiResponse({ status: 409, description: 'งานปิดไปแล้ว แต่ส่ง nextDueDate มาอีก' })
  async complete(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CompleteFollowUpDto,
  ): Promise<{ data: CompletedFollowUpResponseDto; message: string }> {
    const data = await this.followUpsService.complete(id, dto);
    return {
      data,
      message: data.nextFollowUp
        ? 'ปิดงานติดตามและนัดครั้งถัดไปเรียบร้อย'
        : 'ปิดงานติดตามเรียบร้อย',
    };
  }

  @Delete(':id')
  @RequirePermission('followup.delete')
  @ApiOperation({
    summary: 'ลบงานติดตาม',
    description:
      'สำหรับงานที่สร้างผิดจริง ๆ เท่านั้น — งานที่ตัดสินใจว่าไม่ทำแล้วให้เปลี่ยนสถานะ ' +
      'เป็น CANCELLED แทน เพราะยังเป็นข้อมูลที่บอกได้ว่าเคยตั้งใจจะตามลูกค้ารายนี้',
  })
  @ApiParam({ name: 'id', description: 'id ของงานติดตาม', example: 12 })
  @ApiResponse({ status: 200, description: 'ลบเรียบร้อย' })
  @ApiResponse({ status: 404, description: 'ไม่พบงานติดตามนี้' })
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ data: null; message: string }> {
    await this.followUpsService.remove(id);
    return { data: null, message: 'ลบงานติดตามเรียบร้อย' };
  }
}
