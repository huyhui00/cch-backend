import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { type PaginatedResult } from '../../common/dto/pagination.dto';
import { CommunicationLogsService } from './communication-logs.service';
import {
  CreateCommunicationLogDto,
  QueryCommunicationLogsDto,
  UpdateCommunicationLogDto,
} from './dto/communication-log.dto';
import { CommunicationLogResponseDto } from './dto/customer.response';

/**
 * บันทึกการติดต่อลูกค้า (BR-02)
 *
 * การสื่อสารเกิดนอกระบบ — คุยทาง LINE โทรศัพท์ หรือเจอหน้ากัน แล้วค่อยมาบันทึกย้อนหลัง
 * ระบบนี้ไม่ได้ส่งข้อความหาลูกค้า ทำหน้าที่แค่เก็บว่าเคยคุยอะไรกันไว้เมื่อไร
 * ทุกบันทึกจึงบังคับให้ระบุ channel เสมอ
 */
@ApiTags('communication-logs')
@ApiBearerAuth('access-token')
@Controller('communication-logs')
export class CommunicationLogsController {
  constructor(private readonly logsService: CommunicationLogsService) {}

  @Get()
  @RequirePermission('communication.view')
  @ApiOperation({
    summary: 'ประวัติการติดต่อ',
    description:
      'กรองตามลูกค้า ผู้ติดต่อ ช่องทาง ผู้ที่คุย หรือช่วงวันที่ได้ ' +
      'เรียงตามเวลาที่คุยจริง (occurredAt) เป็นค่าเริ่มต้น',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [CommunicationLogResponseDto] })
  @ApiResponse({ status: 400, description: 'พารามิเตอร์ค้นหาไม่ถูกต้อง' })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  findAll(
    @Query() query: QueryCommunicationLogsDto,
  ): Promise<PaginatedResult<CommunicationLogResponseDto>> {
    return this.logsService.findAll(query);
  }

  @Get(':id')
  @RequirePermission('communication.view')
  @ApiOperation({ summary: 'บันทึกการติดต่อรายการเดียว' })
  @ApiParam({ name: 'id', description: 'id ของบันทึก', example: 10 })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: CommunicationLogResponseDto })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบบันทึกการติดต่อ' })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<CommunicationLogResponseDto> {
    return this.logsService.findOne(id);
  }

  @Post()
  @RequirePermission('communication.create')
  @ApiOperation({
    summary: 'บันทึกการติดต่อ',
    description:
      'occurredAt คือเวลาที่คุยกันจริง บันทึกย้อนหลังได้แต่ล่วงหน้าไม่ได้ ' +
      'เมื่อบันทึกแล้วระบบจะอัปเดต lastContactedAt ของลูกค้าให้อัตโนมัติ ' +
      'ถ้าไม่ระบุ handledByUserId ระบบถือว่าคนที่บันทึกเป็นคนคุยเอง',
  })
  @ApiResponse({
    status: 201,
    description: 'บันทึกการติดต่อเรียบร้อย',
    type: CommunicationLogResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'ข้อมูลไม่ถูกต้อง ผู้ติดต่อไม่ได้อยู่ใต้ลูกค้ารายนี้ หรือเวลาเป็นอนาคต',
  })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลลูกค้า' })
  async create(
    @Body() dto: CreateCommunicationLogDto,
    @CurrentUser('id') actorId: number,
  ): Promise<{ data: CommunicationLogResponseDto; message: string }> {
    return {
      data: await this.logsService.create(dto, actorId),
      message: 'บันทึกการติดต่อเรียบร้อย',
    };
  }

  @Put(':id')
  @RequirePermission('communication.update')
  @ApiOperation({
    summary: 'แก้ไขบันทึกการติดต่อ',
    description: 'ย้ายบันทึกไปลูกค้ารายอื่นไม่ได้ ถ้าบันทึกผิดรายให้ลบแล้วสร้างใหม่',
  })
  @ApiParam({ name: 'id', description: 'id ของบันทึก', example: 10 })
  @ApiResponse({
    status: 200,
    description: 'บันทึกการแก้ไขเรียบร้อย',
    type: CommunicationLogResponseDto,
  })
  @ApiResponse({ status: 400, description: 'ข้อมูลไม่ถูกต้อง' })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบบันทึกการติดต่อ' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCommunicationLogDto,
    @CurrentUser('id') actorId: number,
  ): Promise<{ data: CommunicationLogResponseDto; message: string }> {
    return {
      data: await this.logsService.update(id, dto, actorId),
      message: 'บันทึกการแก้ไขเรียบร้อย',
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('communication.delete')
  @ApiOperation({
    summary: 'ลบบันทึกการติดต่อ',
    description:
      'เป็น soft delete และไม่ย้อนค่า lastContactedAt ของลูกค้ากลับให้ ' +
      'ร่องรอยการลบถูกเก็บไว้ใน audit log',
  })
  @ApiParam({ name: 'id', description: 'id ของบันทึก', example: 10 })
  @ApiResponse({ status: 200, description: 'ลบบันทึกการติดต่อเรียบร้อย' })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบบันทึกการติดต่อ' })
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') actorId: number,
  ): Promise<{ data: null; message: string }> {
    await this.logsService.remove(id, actorId);
    return { data: null, message: 'ลบบันทึกการติดต่อเรียบร้อย' };
  }
}
