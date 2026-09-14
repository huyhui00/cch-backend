import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { type PaginatedResult } from '../../common/dto/pagination.dto';
import { CreateResolutionDto } from './dto/resolution.dto';
import {
  AssignTicketDto,
  BillingSuggestionQueryDto,
  CloseTicketDto,
  CreateTicketDto,
  QueryPendingTicketsDto,
  UpdateTicketDto,
  QueryTicketsDto,
  ReopenTicketDto,
} from './dto/ticket.dto';
import { ResolutionCreatedDto, TicketResponseDto } from './dto/ticket.response';
import { TicketsService } from './tickets.service';

/**
 * ใบแจ้งปัญหา (BR-03, BR-04, BR-07, BR-08)
 *
 * ⚠ **ไม่มี endpoint ที่เปิดใบใหม่จากใบเดิม และจะต้องไม่มีตลอดไป**
 * ปัญหาเดิมกลับมา = `PATCH /:id/reopen` แล้ว `POST /:id/resolutions` ในใบเดิม (BR-04)
 * ถ้าเปิดใบใหม่ ประวัติการแก้จะกระจายอยู่หลายใบจนไม่มีใครรู้ว่าเรื่องเดียวกันแก้ไปกี่รอบแล้ว
 *
 * ไม่มี DELETE เช่นกัน — ใบที่บันทึกผิดให้ปิดงานพร้อมหมายเหตุ ประวัติต้องอยู่ครบ (BR-09)
 */
@ApiTags('tickets')
@ApiBearerAuth('access-token')
@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  @RequirePermission('ticket.view')
  @ApiOperation({
    summary: 'รายการใบแจ้งปัญหา',
    description: 'กรองตามสถานะ ลูกค้า โครงการ ความสำคัญ ผู้รับผิดชอบ หรือประเภทการคิดเงินได้',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [TicketResponseDto] })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  findAll(@Query() query: QueryTicketsDto): Promise<PaginatedResult<TicketResponseDto>> {
    return this.ticketsService.findAll(query);
  }

  // ต้องประกาศก่อน :id ไม่งั้น "pending" จะถูกจับเป็น id แล้วพังที่ ParseIntPipe
  @Get('pending')
  @RequirePermission('ticket.view')
  @ApiOperation({
    summary: 'หน้าจอรอรับการแก้ไข',
    description:
      'เฉพาะใบที่สถานะเป็น RECEIVED, REOPENED หรือ IN_PROGRESS (CLAUDE.md 9.1) ' +
      'ไม่เปิดให้กรองด้วย status เพราะชุดสถานะเป็นนิยามของหน้าจอนี้ ' +
      'เรียงงานด่วนขึ้นก่อน แล้วค้างนานสุดขึ้นก่อนในระดับความสำคัญเดียวกัน',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [TicketResponseDto] })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  findPending(@Query() query: QueryPendingTicketsDto): Promise<PaginatedResult<TicketResponseDto>> {
    return this.ticketsService.findPending(query);
  }

  @Get('billing-suggestion')
  @RequirePermission('ticket.view')
  @ApiOperation({
    summary: 'ตรวจ Warranty และ MA ก่อนเปิดใบแจ้งปัญหา',
    description:
      'คืนคำแนะนำประเภทการคิดเงินพร้อมขอบเขตและวันหมด Warranty โดยไม่สร้างข้อมูล ' +
      'ถ้ามีทั้ง Warranty และ MA ระบบจะเลือก Warranty ก่อน และระบุ MA เป็นข้อมูลอ้างอิงเท่านั้น',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: Object })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  getBillingSuggestion(@Query() query: BillingSuggestionQueryDto) {
    return this.ticketsService.suggestBilling(query.projectId, new Date(query.reportedAt));
  }

  @Get(':id')
  @RequirePermission('ticket.view')
  @ApiOperation({
    summary: 'รายละเอียดปัญหา พร้อมทุกรอบที่ลงมือแก้',
    description: 'คืน resolutions ทั้งหมดเรียงตาม round จากน้อยไปมาก (BR-03)',
  })
  @ApiParam({ name: 'id', description: 'id ของใบแจ้งปัญหา', example: 7 })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: TicketResponseDto })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบรายการปัญหานี้' })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<TicketResponseDto> {
    return this.ticketsService.findOne(id);
  }

  @Post()
  @RequirePermission('ticket.create')
  @ApiOperation({
    summary: 'เปิดใบแจ้งปัญหา',
    description:
      'พนักงานเป็นคนเปิดเสมอ ลูกค้าไม่มีบัญชีผู้ใช้ (BR-01) ' +
      'ไม่ส่ง billingType มา = ระบบเลือกให้จากประกันก่อน แล้วค่อยดูสัญญา MA ' +
      'ส่งมา = ใช้ค่าที่ส่งเสมอ เพราะงานที่ขอเพิ่มใหม่ต้องคิดเงินแม้อยู่ในระยะประกัน (BR-07) ' +
      'ไม่เจออะไรเลยและไม่ได้เลือกมา = ONE_TIME',
  })
  @ApiResponse({ status: 201, description: 'เปิดใบแจ้งปัญหาเรียบร้อย', type: TicketResponseDto })
  @ApiResponse({ status: 400, description: 'ข้อมูลไม่ถูกต้อง หรือเวลาที่แจ้งเป็นอนาคต' })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 409, description: 'เลขที่ใบแจ้งปัญหานี้ถูกใช้ไปแล้ว' })
  async create(
    @Body() dto: CreateTicketDto,
  ): Promise<{ data: TicketResponseDto; message: string }> {
    return {
      data: await this.ticketsService.create(dto),
      message: 'เปิดใบแจ้งปัญหาเรียบร้อย',
    };
  }

  @Patch(':id')
  @RequirePermission('ticket.update')
  @ApiOperation({
    summary: 'แก้ไขใบแจ้งปัญหา',
    description:
      'สำหรับกรณีคีย์ผิดตอนเปิดใบ — **แก้สถานะที่นี่ไม่ได้** เพราะสถานะมีเจ้าของอยู่แล้ว ' +
      'คือ assign / resolutions / reopen / close ถ้าแก้ตรง ๆ ได้จะข้ามกฎ BR-04 ทั้งหมด ' +
      'ย้ายลูกค้าไม่ได้ ย้ายโครงการได้เฉพาะโครงการของลูกค้ารายเดิม ' +
      'ใบที่ปิดงานแล้วยังแก้ข้อมูลได้ เพราะการพิมพ์ผิดต้องแก้ได้เสมอ',
  })
  @ApiParam({ name: 'id', description: 'id ของใบแจ้งปัญหา', example: 7 })
  @ApiResponse({ status: 200, description: 'แก้ไขเรียบร้อย', type: TicketResponseDto })
  @ApiResponse({ status: 400, description: 'โครงการหรือผู้ติดต่อไม่ใช่ของลูกค้ารายนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบรายการปัญหานี้' })
  @ApiResponse({ status: 409, description: 'เลขที่ใบแจ้งปัญหาซ้ำ' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTicketDto,
  ): Promise<{ data: TicketResponseDto; message: string }> {
    return {
      data: await this.ticketsService.update(id, dto),
      message: 'แก้ไขใบแจ้งปัญหาเรียบร้อย',
    };
  }

  @Patch(':id/assign')
  @RequirePermission('ticket.assign')
  @ApiOperation({
    summary: 'มอบหมายผู้รับผิดชอบแก้ไข',
    description:
      'แยกจากผู้รับเรื่องที่บันทึกไว้ตอนเปิดใบ (A-3) — ใบที่เป็น RECEIVED หรือ REOPENED ' +
      'จะถูกเลื่อนเป็น ASSIGNED (ส่งงานแล้ว) ผู้รับผิดชอบต้องกดเริ่มงานเองจึงเป็น IN_PROGRESS ' +
      'ด้วยการมอบหมายซ้ำ แม้เป็นคนเดิมก็ตาม (BR-04) ส่ง assignedUserId เป็น null เพื่อถอนการมอบหมาย ' +
      'ผู้รับผิดชอบต้องเป็นพนักงานที่ยังอยู่ในสถานะใช้งาน',
  })
  @ApiParam({ name: 'id', description: 'id ของใบแจ้งปัญหา', example: 7 })
  @ApiResponse({ status: 200, description: 'มอบหมายเรียบร้อย', type: TicketResponseDto })
  @ApiResponse({ status: 400, description: 'ปัญหาปิดงานแล้ว หรือพนักงานไม่อยู่ในสถานะใช้งาน' })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบรายการปัญหานี้' })
  async assign(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignTicketDto,
  ): Promise<{ data: TicketResponseDto; message: string }> {
    return { data: await this.ticketsService.assign(id, dto), message: 'มอบหมายเรียบร้อย' };
  }

  @Patch(':id/start')
  @RequirePermission('ticket.update')
  @ApiOperation({
    summary: 'เริ่มดำเนินการแก้ไข',
    description: 'ผู้รับผิดชอบเท่านั้นที่เริ่มงานได้ หลังสถานะเป็น ASSIGNED',
  })
  @ApiParam({ name: 'id', description: 'id ของใบแจ้งปัญหา', example: 7 })
  @ApiResponse({ status: 200, description: 'เริ่มดำเนินการแล้ว', type: TicketResponseDto })
  @ApiResponse({ status: 403, description: 'เฉพาะผู้รับผิดชอบเท่านั้นที่เริ่มงานนี้ได้' })
  @ApiResponse({ status: 409, description: 'สถานะใบแจ้งปัญหาไม่ถูกต้องสำหรับการเริ่มงาน' })
  async start(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ data: TicketResponseDto; message: string }> {
    return { data: await this.ticketsService.start(id), message: 'เริ่มดำเนินการแก้ไขแล้ว' };
  }

  @Post(':id/resolutions')
  @RequirePermission('ticket.resolve')
  @ApiOperation({
    summary: 'บันทึกผลการแก้ไขหนึ่งรอบ',
    description:
      '1 ปัญหา แก้ได้หลายรอบ (BR-03) — ระบบนับ round ให้เองจากรอบที่มีอยู่ + 1 ห้ามส่งมาเอง ' +
      'ทั้งการสร้างรอบ การอัปเดตสถานะเป็น RESOLVED และการหักโควตา MA อยู่ในทรานแซกชันเดียว ' +
      'ปัญหาที่ปิดงานแล้วเพิ่มรอบตรง ๆ ไม่ได้ ต้อง PATCH /:id/reopen ก่อน ' +
      '⚠ โควตา MA ถูกหักครั้งเดียวต่อใบ ไม่ว่าจะแก้กี่รอบ รอบที่ 2 ขึ้นไปจึงได้ quota เป็น null',
  })
  @ApiParam({ name: 'id', description: 'id ของใบแจ้งปัญหา', example: 7 })
  @ApiResponse({
    status: 201,
    description: 'บันทึกผลการแก้ไขเรียบร้อย',
    type: ResolutionCreatedDto,
  })
  @ApiResponse({
    status: 400,
    description: 'ปัญหานี้ปิดงานแล้ว (ต้องเปิดกลับมาก่อน) หรือเวลาที่แก้เสร็จเป็นอนาคต',
  })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบรายการปัญหานี้' })
  async addResolution(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateResolutionDto,
  ): Promise<{ data: ResolutionCreatedDto; message: string }> {
    return {
      data: await this.ticketsService.addResolution(id, dto),
      message: 'บันทึกผลการแก้ไขเรียบร้อย',
    };
  }

  @Patch(':id/reopen')
  @RequirePermission('ticket.reopen')
  @ApiOperation({
    summary: 'ปัญหาเดิมกลับมา — เปิดใบเดิมขึ้นมาใหม่',
    description:
      'BR-04 ปัญหาเดิมกลับมาต้องเพิ่มรอบในใบเดิม **ห้ามเปิดใบใหม่** ' +
      'endpoint นี้พาใบกลับเข้าสถานะ REOPENED เพื่อให้กลับเข้าหน้าจอรอรับการแก้ไข ' +
      'แล้วรอบถัดไปบันทึกผ่าน POST /:id/resolutions ตามปกติ ซึ่งจะได้ round ต่อจากเดิม ' +
      'ประวัติเดิมไม่ถูกล้าง — **ใช้กับใบที่ปิดงานแล้ว (CLOSED) ได้ด้วย** ไม่จำกัดว่าปิดมานานเท่าไร ' +
      'และล้าง closedAt ให้ หน้าจอเรียก PATCH /:id/assign ต่อทันทีเพื่อให้เป็น IN_PROGRESS ' +
      'ในจังหวะเดียว (ต้องมีทั้งสิทธิ์ ticket.reopen และ ticket.assign)',
  })
  @ApiParam({ name: 'id', description: 'id ของใบแจ้งปัญหา', example: 7 })
  @ApiResponse({ status: 200, description: 'เปิดปัญหากลับมาเรียบร้อย', type: TicketResponseDto })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบรายการปัญหานี้' })
  @ApiResponse({ status: 409, description: 'ปัญหานี้ถูกเปิดกลับมาอยู่แล้ว' })
  async reopen(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReopenTicketDto,
  ): Promise<{ data: TicketResponseDto; message: string }> {
    return {
      data: await this.ticketsService.reopen(id, dto),
      message: 'เปิดปัญหากลับมาเรียบร้อย',
    };
  }

  @Patch(':id/close')
  @RequirePermission('ticket.close')
  @ApiOperation({
    summary: 'ปิดงาน',
    description:
      'ปิดได้จากทุกสถานะที่ยังไม่ปิด ไม่บังคับว่าต้องมีรอบการแก้ก่อน เพราะมีเคสที่ตรวจแล้ว ' +
      'ไม่ใช่ปัญหาของเราหรือลูกค้าถอนเรื่อง ปิดแล้วเพิ่มรอบตรง ๆ ไม่ได้ ' +
      'ถ้าปัญหาเดิมกลับมาให้ PATCH /:id/reopen ในใบเดิม (BR-04)',
  })
  @ApiParam({ name: 'id', description: 'id ของใบแจ้งปัญหา', example: 7 })
  @ApiResponse({ status: 200, description: 'ปิดงานเรียบร้อย', type: TicketResponseDto })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบรายการปัญหานี้' })
  @ApiResponse({ status: 409, description: 'ปัญหานี้ปิดงานแล้ว' })
  async close(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CloseTicketDto,
  ): Promise<{ data: TicketResponseDto; message: string }> {
    return { data: await this.ticketsService.close(id, dto), message: 'ปิดงานเรียบร้อย' };
  }
}
