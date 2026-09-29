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
  QueryAdminQueueDto,
  QueryPendingTicketsDto,
  QuerySupportQueueDto,
  UpdateTicketDto,
  QueryTicketsDto,
  RejectReviewDto,
  ReopenTicketDto,
  ReturnToSupportDto,
} from './dto/ticket.dto';
import {
  ResolutionCreatedDto,
  TicketConfirmationPrintDto,
  TicketResponseDto,
} from './dto/ticket.response';
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
    description:
      'กรองตามสถานะ ลูกค้า โครงการ ความสำคัญ ผู้รับผิดชอบ หรือประเภทการคิดเงินได้ · `sortBy` = ' +
      'ticketNo / status / priority / reportedAt / dueAt / resolvedAt / createdAt / ' +
      'customerName / projectName / assigneeName',
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
      'เฉพาะใบที่สถานะเป็น RECEIVED, WAITING_ADMIN, ASSIGNED, REOPENED หรือ IN_PROGRESS ' +
      'ไม่เปิดให้กรองด้วย status เพราะชุดสถานะเป็นนิยามของหน้าจอนี้ ' +
      'เรียงงานด่วนขึ้นก่อน แล้วค้างนานสุดขึ้นก่อนในระดับความสำคัญเดียวกัน',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [TicketResponseDto] })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  findPending(@Query() query: QueryPendingTicketsDto): Promise<PaginatedResult<TicketResponseDto>> {
    return this.ticketsService.findPending(query);
  }

  @Get('support-queue')
  @RequirePermission('ticket.support_queue')
  @ApiOperation({
    summary: 'คิวซัพพอร์ต (C-1)',
    description:
      'ต้องมีสิทธิ์ ticket.support_queue (แยกจาก ticket.view / ticket.create ของหน้าปัญหา) · ' +
      'แท็บ AWAITING_SEND = รับเรื่องแล้วรอส่งหัวหน้า · RETURNED = แอดมินตรวจผ่านแล้วรอบอกลูกค้า',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [TicketResponseDto] })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  findSupportQueue(
    @Query() query: QuerySupportQueueDto,
  ): Promise<PaginatedResult<TicketResponseDto>> {
    return this.ticketsService.findSupportQueue(query);
  }

  @Get('admin-queue')
  @RequirePermission('ticket.assign')
  @ApiOperation({
    summary: 'คิวแอดมิน / หัวหน้า (C-1)',
    description:
      'AWAITING_CLAIM = รอรับเรื่อง · CLAIMED = รับแล้วรอจัดแจง · ' +
      'AWAITING_REVIEW = รอตรวจผ่าน (RESOLVED) · WITH_SUPPORT = ส่งซัพพอร์ตแล้ว',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [TicketResponseDto] })
  findAdminQueue(@Query() query: QueryAdminQueueDto): Promise<PaginatedResult<TicketResponseDto>> {
    return this.ticketsService.findAdminQueue(query);
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
    description:
      'คืน resolutions ทั้งหมดเรียงตาม round จากน้อยไปมาก (BR-03) · ' +
      'แต่ละรอบมี steps สำหรับ stepper และ attachments ของรอบนั้น (B-11)',
  })
  @ApiParam({ name: 'id', description: 'id ของใบแจ้งปัญหา', example: 7 })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: TicketResponseDto })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบรายการปัญหานี้' })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<TicketResponseDto> {
    return this.ticketsService.findOne(id);
  }

  @Get(':id/confirmation-print')
  @RequirePermission('ticket.view')
  @ApiOperation({
    summary: 'พิมพ์ใบยืนยันการแก้ไขให้ลูกค้าเซ็น (B-12)',
    description:
      'คืน JSON สำหรับจัดหน้าพิมพ์ ไม่สร้าง PDF · เลือกรอบด้วย ?round= ไม่งั้นใช้รอบล่าสุด · ' +
      'หลังลูกค้าเซ็นแล้วสแกนแนบด้วย POST /api/attachments refType=TICKET_RESOLUTION ' +
      '(ดู attachScanHint ในผลลัพธ์) · ไม่มี e-signature (BR-12)',
  })
  @ApiParam({ name: 'id', description: 'id ของใบแจ้งปัญหา', example: 7 })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: TicketConfirmationPrintDto })
  @ApiResponse({ status: 400, description: 'ยังไม่มีรอบการแก้ไข' })
  @ApiResponse({ status: 404, description: 'ไม่พบใบหรือรอบที่ระบุ' })
  getConfirmationPrint(
    @Param('id', ParseIntPipe) id: number,
    @Query('round') round?: string,
  ): Promise<TicketConfirmationPrintDto> {
    const parsed = round !== undefined && round !== '' ? Number(round) : undefined;
    return this.ticketsService.getConfirmationPrint(
      id,
      parsed !== undefined && !Number.isNaN(parsed) ? parsed : undefined,
    );
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
      'แยกจากผู้รับเรื่องและแอดมินผู้รับคิว (C-1) — มอบจาก WAITING_ADMIN ได้หลังกดรับเรื่องแล้ว ' +
      'หรือจาก REOPENED · ไม่มอบจาก RECEIVED ตรง ๆ (ต้องส่งหัวหน้าก่อน) ' +
      'เลื่อนเป็น ASSIGNED แล้วผู้รับผิดชอบกด start เอง · ส่ง null เพื่อถอนการมอบหมาย',
  })
  @ApiParam({ name: 'id', description: 'id ของใบแจ้งปัญหา', example: 7 })
  @ApiResponse({ status: 200, description: 'มอบหมายเรียบร้อย', type: TicketResponseDto })
  @ApiResponse({ status: 400, description: 'ปัญหาปิดงานแล้ว หรือยังไม่ผ่านขั้นส่ง/รับคิว' })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบรายการปัญหานี้' })
  async assign(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignTicketDto,
  ): Promise<{ data: TicketResponseDto; message: string }> {
    return { data: await this.ticketsService.assign(id, dto), message: 'มอบหมายเรียบร้อย' };
  }

  @Patch(':id/send-to-admin')
  @RequirePermission('ticket.support_queue')
  @ApiOperation({
    summary: 'ซัพพอร์ตส่งเข้าคิวกลางให้หัวหน้า (C-1)',
    description:
      'ต้องมี ticket.support_queue · จาก RECEIVED หรือ REOPENED → WAITING_ADMIN · ' +
      'ไม่เลือกแอดมิน · ล้าง claim และผู้แก้เดิม',
  })
  @ApiParam({ name: 'id', description: 'id ของใบแจ้งปัญหา', example: 7 })
  @ApiResponse({ status: 200, description: 'ส่งให้หัวหน้าแล้ว', type: TicketResponseDto })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 409, description: 'สถานะไม่ถูกต้อง' })
  async sendToAdmin(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ data: TicketResponseDto; message: string }> {
    return {
      data: await this.ticketsService.sendToAdmin(id),
      message: 'ส่งให้หัวหน้าแล้ว',
    };
  }

  @Patch(':id/claim')
  @RequirePermission('ticket.assign')
  @ApiOperation({
    summary: 'แอดมินรับเรื่องจากคิวกลาง (C-1)',
    description: 'ตั้ง claimedByAdminUserId เป็นผู้กด · ใบที่มีคนรับแล้วกดซ้ำไม่ได้',
  })
  @ApiParam({ name: 'id', description: 'id ของใบแจ้งปัญหา', example: 7 })
  @ApiResponse({ status: 200, description: 'รับเรื่องเรียบร้อย', type: TicketResponseDto })
  @ApiResponse({ status: 409, description: 'ไม่อยู่ในคิวหรือมีคนรับแล้ว' })
  async claim(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ data: TicketResponseDto; message: string }> {
    return { data: await this.ticketsService.claim(id), message: 'รับเรื่องเรียบร้อย' };
  }

  @Patch(':id/return-to-support')
  @RequirePermission('ticket.assign')
  @ApiOperation({
    summary: 'แอดมินตรวจผ่าน ส่งกลับซัพพอร์ต (C-1)',
    description:
      'จาก RESOLVED → WAITING_SUPPORT เข้าคิวกลางของซัพพอร์ต (ไม่ได้ส่งให้คนเดียว) · ' +
      'body ไม่บังคับ — `note` ถึงซัพพอร์ตถูกต่อท้ายรายละเอียดใบเป็น "[ตรวจผ่าน] ..."',
  })
  @ApiParam({ name: 'id', description: 'id ของใบแจ้งปัญหา', example: 7 })
  @ApiResponse({ status: 200, description: 'ส่งกลับซัพพอร์ตแล้ว', type: TicketResponseDto })
  @ApiResponse({ status: 409, description: 'ยังไม่ใช่สถานะ RESOLVED' })
  async returnToSupport(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReturnToSupportDto,
  ): Promise<{ data: TicketResponseDto; message: string }> {
    return {
      data: await this.ticketsService.returnToSupport(id, dto),
      message: 'ส่งกลับซัพพอร์ตแล้ว',
    };
  }

  @Patch(':id/reject-review')
  @RequirePermission('ticket.assign')
  @ApiOperation({
    summary: 'แอดมินตรวจไม่ผ่าน ตีกลับให้ผู้แก้ (C-1)',
    description:
      'จาก RESOLVED → IN_PROGRESS · ผู้แก้และแอดมินผู้รับคิวคงเดิม · ต้องระบุ `reason` ' +
      'ซึ่งถูกต่อท้ายรายละเอียดใบเป็น "[ตรวจไม่ผ่าน] ..." และส่งแจ้งเตือนในแอปถึงผู้แก้ ' +
      '(TICKET_REVIEW_REJECTED) · งานที่ส่งใหม่เป็นรอบถัดไปของใบเดิม โควตา MA ไม่ถูกหักซ้ำ',
  })
  @ApiParam({ name: 'id', description: 'id ของใบแจ้งปัญหา', example: 7 })
  @ApiResponse({ status: 200, description: 'ตีกลับให้ผู้แก้แล้ว', type: TicketResponseDto })
  @ApiResponse({ status: 400, description: 'ไม่ได้ระบุเหตุผล' })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 409, description: 'ใบไม่อยู่ในสถานะรอตรวจ หรือไม่มีผู้รับผิดชอบ' })
  async rejectReview(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectReviewDto,
  ): Promise<{ data: TicketResponseDto; message: string }> {
    return {
      data: await this.ticketsService.rejectReview(id, dto),
      message: 'ตีกลับให้ผู้แก้แล้ว',
    };
  }

  @Patch(':id/customer-notified')
  @RequirePermission('ticket.support_queue')
  @ApiOperation({
    summary: 'ซัพพอร์ตบอกลูกค้าแล้ว ปิดใบ (C-1)',
    description:
      'ต้องมี ticket.support_queue · จาก WAITING_SUPPORT → CLOSED · ' +
      'คนละสิทธิ์กับ PATCH /:id/close (ticket.close) ที่ปิดใบจากหน้ารายละเอียด',
  })
  @ApiParam({ name: 'id', description: 'id ของใบแจ้งปัญหา', example: 7 })
  @ApiResponse({
    status: 200,
    description: 'บอกลูกค้าแล้ว ปิดใบเรียบร้อย',
    type: TicketResponseDto,
  })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 409, description: 'ยังไม่ใช่สถานะรอซัพพอร์ตบอกลูกค้า' })
  async customerNotified(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CloseTicketDto,
  ): Promise<{ data: TicketResponseDto; message: string }> {
    return {
      data: await this.ticketsService.customerNotified(id, dto),
      message: 'บอกลูกค้าแล้ว ปิดใบเรียบร้อย',
    };
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
