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
  CreateAssignmentDto,
  CreateResponseDto,
  CreateSurveyDto,
  QueryAssignmentsDto,
  QuerySurveysDto,
  UpdateSurveyDto,
  UpdateSurveyStatusDto,
} from './dto/survey.dto';
import {
  AssignmentResponseDto,
  ResponseDetailDto,
  SurveyResponseDto,
  SurveySummaryDto,
} from './dto/survey.response';
import { SurveysService } from './surveys.service';

/**
 * M8 — แบบประเมินความพึงพอใจ
 *
 * **ทุกเส้นต้องล็อกอิน ไม่มี `@Public()` แม้แต่เส้นเดียว** — Q1 สรุปแล้วว่าพนักงาน
 * เป็นคนบันทึกคำตอบแทนลูกค้า ระบบทำฟอร์ม → ส่งให้ลูกค้ารีวิวนอกระบบ → คีย์กลับเข้ามา
 * ลูกค้าไม่มีบัญชีผู้ใช้และไม่ได้เข้าระบบเลย (BR-01)
 *
 * ถ้าวันหนึ่งผู้บริหารอยากได้ลิงก์ให้ลูกค้ากรอกเอง ให้เพิ่ม controller ใหม่ที่ติด
 * `@Public()` และใช้ `survey_assignments.access_token` ที่เตรียมคอลัมน์ไว้แล้ว
 * — เป็นการเพิ่ม ไม่ใช่รื้อของเดิม
 */
@ApiTags('surveys')
@ApiBearerAuth('access-token')
@Controller('surveys')
export class SurveysController {
  constructor(private readonly surveysService: SurveysService) {}

  @Get()
  @RequirePermission('survey.view')
  @ApiOperation({
    summary: 'รายการแบบประเมิน',
    description: 'กรองตามสถานะได้ พร้อมคำถามและจำนวนที่ส่ง/ตอบกลับของแต่ละฉบับ',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [SurveyResponseDto] })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  findAll(@Query() query: QuerySurveysDto): Promise<PaginatedResult<SurveyResponseDto>> {
    return this.surveysService.findAll(query);
  }

  @Get(':id')
  @RequirePermission('survey.view')
  @ApiOperation({ summary: 'รายละเอียดแบบประเมินพร้อมคำถาม' })
  @ApiParam({ name: 'id', description: 'id ของแบบประเมิน', example: 3 })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: SurveyResponseDto })
  @ApiResponse({ status: 404, description: 'ไม่พบแบบประเมินนี้' })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<SurveyResponseDto> {
    return this.surveysService.findOne(id);
  }

  @Get(':id/summary')
  @RequirePermission('survey.view')
  @ApiOperation({
    summary: 'สรุปผลแบบประเมิน',
    description:
      'คะแนนเฉลี่ยรวม อัตราการตอบกลับ และสรุปรายคำถาม — คำถามแบบให้คะแนนได้ค่าเฉลี่ย ' +
      'แบบเลือกตอบได้จำนวนคนที่เลือกแต่ละตัวเลือก (รวมตัวเลือกที่ยังไม่มีใครเลือก) ' +
      'แบบพิมพ์ตอบได้รายการคำตอบทั้งหมด',
  })
  @ApiParam({ name: 'id', description: 'id ของแบบประเมิน', example: 3 })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: SurveySummaryDto })
  @ApiResponse({ status: 404, description: 'ไม่พบแบบประเมินนี้' })
  summarize(@Param('id', ParseIntPipe) id: number): Promise<SurveySummaryDto> {
    return this.surveysService.summarize(id);
  }

  @Get(':id/assignments')
  @RequirePermission('survey.view')
  @ApiOperation({
    summary: 'ประวัติการส่งแบบประเมินให้ลูกค้า',
    description: 'แต่ละแถวคือการส่ง 1 ครั้ง มี responseId ถ้าบันทึกคำตอบกลับมาแล้ว',
  })
  @ApiParam({ name: 'id', description: 'id ของแบบประเมิน', example: 3 })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [AssignmentResponseDto] })
  @ApiResponse({ status: 404, description: 'ไม่พบแบบประเมินนี้' })
  findAssignments(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: QueryAssignmentsDto,
  ): Promise<PaginatedResult<AssignmentResponseDto>> {
    return this.surveysService.findAssignments(id, query);
  }

  @Get(':id/responses')
  @RequirePermission('survey.view')
  @ApiOperation({
    summary: 'คำตอบทั้งหมดของแบบประเมิน',
    description: 'เรียงตามเวลาที่ลูกค้าตอบจากใหม่ไปเก่า พร้อมคำตอบรายข้อ',
  })
  @ApiParam({ name: 'id', description: 'id ของแบบประเมิน', example: 3 })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [ResponseDetailDto] })
  @ApiResponse({ status: 404, description: 'ไม่พบแบบประเมินนี้' })
  findResponses(@Param('id', ParseIntPipe) id: number): Promise<ResponseDetailDto[]> {
    return this.surveysService.findResponses(id);
  }

  @Post()
  @RequirePermission('survey.create')
  @ApiOperation({
    summary: 'สร้างแบบประเมิน',
    description:
      'ส่งคำถามมาพร้อมกันได้เลย — เริ่มที่สถานะ DRAFT เสมอ ต้องกดเปลี่ยนเป็น ACTIVE ' +
      'เองเมื่อคำถามพร้อมแล้ว',
  })
  @ApiResponse({ status: 201, description: 'สร้างเรียบร้อย', type: SurveyResponseDto })
  @ApiResponse({ status: 400, description: 'คำถามไม่ครบตามชนิดของตัวเอง หรือช่วงวันไม่ถูกต้อง' })
  async create(
    @Body() dto: CreateSurveyDto,
  ): Promise<{ data: SurveyResponseDto; message: string }> {
    return { data: await this.surveysService.create(dto), message: 'สร้างแบบประเมินเรียบร้อย' };
  }

  @Patch(':id')
  @RequirePermission('survey.update')
  @ApiOperation({
    summary: 'แก้ไขแบบประเมิน',
    description:
      'ส่ง questions มาเมื่อไหร่ = แทนที่คำถามทั้งชุด **ทำได้เฉพาะตอนสถานะเป็น DRAFT** ' +
      'เพราะคำตอบที่เก็บมาแล้วอ้างถึงคำถามเดิม — ชื่อ คำอธิบาย และช่วงวันที่แก้ได้ตลอด',
  })
  @ApiParam({ name: 'id', description: 'id ของแบบประเมิน', example: 3 })
  @ApiResponse({ status: 200, description: 'แก้ไขเรียบร้อย', type: SurveyResponseDto })
  @ApiResponse({ status: 404, description: 'ไม่พบแบบประเมินนี้' })
  @ApiResponse({ status: 409, description: 'แก้คำถามของแบบประเมินที่ไม่ใช่ฉบับร่าง' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSurveyDto,
  ): Promise<{ data: SurveyResponseDto; message: string }> {
    return { data: await this.surveysService.update(id, dto), message: 'แก้ไขแบบประเมินเรียบร้อย' };
  }

  @Patch(':id/status')
  @RequirePermission('survey.update')
  @ApiOperation({
    summary: 'เปลี่ยนสถานะแบบประเมิน',
    description:
      'DRAFT → ACTIVE ต้องมีคำถามอย่างน้อย 1 ข้อ / ACTIVE → CLOSED ปิดรับคำตอบ / ' +
      'ย้อนกลับเป็น DRAFT ได้เฉพาะที่ยังไม่มีคำตอบเลย',
  })
  @ApiParam({ name: 'id', description: 'id ของแบบประเมิน', example: 3 })
  @ApiResponse({ status: 200, description: 'เปลี่ยนสถานะเรียบร้อย', type: SurveyResponseDto })
  @ApiResponse({ status: 400, description: 'เปลี่ยนเป็น ACTIVE ทั้งที่ยังไม่มีคำถาม' })
  @ApiResponse({ status: 409, description: 'ย้อนกลับเป็นฉบับร่างทั้งที่มีคำตอบแล้ว' })
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSurveyStatusDto,
  ): Promise<{ data: SurveyResponseDto; message: string }> {
    return {
      data: await this.surveysService.updateStatus(id, dto.status),
      message: 'เปลี่ยนสถานะแบบประเมินเรียบร้อย',
    };
  }

  @Post(':id/assignments')
  @RequirePermission('survey.send')
  @ApiOperation({
    summary: 'บันทึกว่าส่งแบบประเมินให้ลูกค้าแล้ว',
    description:
      '**ระบบไม่ได้ส่งอะไรออกไปจริง** (BR-11 ไม่ยิงหาลูกค้า) การส่งเกิดนอกระบบ — ' +
      'แถวนี้คือหลักฐานว่าส่งให้ใคร เมื่อไหร่ และเป็นที่ผูกคำตอบกลับมา ' +
      'ส่งได้เฉพาะแบบประเมินที่สถานะเป็น ACTIVE',
  })
  @ApiParam({ name: 'id', description: 'id ของแบบประเมิน', example: 3 })
  @ApiResponse({ status: 201, description: 'บันทึกการส่งเรียบร้อย', type: AssignmentResponseDto })
  @ApiResponse({
    status: 400,
    description: 'แบบประเมินยังไม่ ACTIVE หรือผู้ติดต่อไม่ใช่ของลูกค้ารายนี้',
  })
  @ApiResponse({ status: 404, description: 'ไม่พบแบบประเมินหรือลูกค้า' })
  async createAssignment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateAssignmentDto,
  ): Promise<{ data: AssignmentResponseDto; message: string }> {
    return {
      data: await this.surveysService.createAssignment(id, dto),
      message: 'บันทึกการส่งแบบประเมินเรียบร้อย',
    };
  }

  @Delete(':id')
  @RequirePermission('survey.delete')
  @ApiOperation({
    summary: 'ลบแบบประเมิน',
    description:
      'ลบได้เฉพาะฉบับที่ยังไม่เคยถูกส่งให้ลูกค้า — ฉบับที่ส่งไปแล้วให้เปลี่ยนสถานะ ' +
      'เป็น CLOSED แทน ผลที่เก็บไว้จะยังดูย้อนหลังได้',
  })
  @ApiParam({ name: 'id', description: 'id ของแบบประเมิน', example: 3 })
  @ApiResponse({ status: 200, description: 'ลบเรียบร้อย' })
  @ApiResponse({ status: 404, description: 'ไม่พบแบบประเมินนี้' })
  @ApiResponse({ status: 409, description: 'แบบประเมินนี้ถูกส่งให้ลูกค้าไปแล้ว' })
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ data: null; message: string }> {
    await this.surveysService.remove(id);
    return { data: null, message: 'ลบแบบประเมินเรียบร้อย' };
  }
}

/**
 * บันทึกคำตอบที่ลูกค้าให้มา — แยก controller เพราะผูกกับ "การส่ง 1 ครั้ง"
 * ไม่ใช่กับตัวแบบประเมิน (1 การส่ง ตอบได้ครั้งเดียว)
 */
@ApiTags('surveys')
@ApiBearerAuth('access-token')
@Controller('survey-assignments')
export class SurveyAssignmentsController {
  constructor(private readonly surveysService: SurveysService) {}

  @Post(':id/response')
  @RequirePermission('survey.send')
  @ApiOperation({
    summary: 'บันทึกคำตอบแทนลูกค้า',
    description:
      'Q1 — พนักงานคีย์คำตอบที่ลูกค้าให้มาทางไลน์/โทรศัพท์/กระดาษ ระบบบันทึกไว้ว่าใครเป็นคนคีย์ ' +
      'ระบบตรวจคำตอบให้ตรงชนิดของคำถามให้เอง (คะแนนต้องอยู่ในช่วง ตัวเลือกต้องมีจริง ' +
      'คำถามที่บังคับต้องมีคำตอบ) และคำนวณคะแนนเฉลี่ยให้ ไม่รับจาก client — ' +
      'บันทึกเวลาที่ลูกค้าตอบย้อนหลังได้ แต่ล่วงหน้าไม่ได้ (BR-02)',
  })
  @ApiParam({ name: 'id', description: 'id ของการส่งแบบประเมิน', example: 15 })
  @ApiResponse({ status: 201, description: 'บันทึกคำตอบเรียบร้อย', type: ResponseDetailDto })
  @ApiResponse({ status: 400, description: 'คำตอบไม่ตรงชนิดคำถาม หรือตอบไม่ครบข้อที่บังคับ' })
  @ApiResponse({ status: 404, description: 'ไม่พบการส่งแบบประเมินครั้งนี้' })
  @ApiResponse({ status: 409, description: 'การส่งครั้งนี้บันทึกคำตอบไปแล้ว' })
  async createResponse(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateResponseDto,
  ): Promise<{ data: ResponseDetailDto; message: string }> {
    return {
      data: await this.surveysService.createResponse(id, dto),
      message: 'บันทึกคำตอบเรียบร้อย',
    };
  }
}
