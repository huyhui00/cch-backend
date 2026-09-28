import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { PaginationDto, type PaginatedResult } from '../../common/dto/pagination.dto';
import {
  CompanyTaskResponseDto,
  TaskBoardSummaryDto,
  TaskResponseDto,
  TaskReviewItemDto,
} from './dto/project.response';
import {
  MAX_UPLOAD_MB,
  UPLOAD_INTERCEPTOR_OPTIONS,
  ALLOWED_EXTENSIONS,
  contentDisposition,
  type UploadedFileLike,
} from '../files/upload.util';
import {
  QueryCompanyTasksDto,
  QueryDueSoonTasksDto,
  QueryOverdueTasksDto,
  QueryTaskBoardDto,
  UpdateTaskOrderDto,
  UpdateTaskStatusDto,
} from './dto/task.dto';
import {
  CreateTaskSubmissionDto,
  QueryTaskReviewsDto,
  ReviewTaskDto,
} from './dto/task-submission.dto';
import { TasksService } from './tasks.service';

/**
 * การทำงานกับงานที่ข้ามโครงการ — ผู้ใช้ทำจากหน้าจอรวม ไม่ได้เข้าไปทีละโครงการ
 * ส่วน CRUD ของงานอยู่ใต้ /api/projects/:projectId/tasks
 */
@ApiTags('tasks')
@ApiBearerAuth('access-token')
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get('submissions/:submissionId/download')
  @RequirePermission('task.view')
  @ApiProduces('application/octet-stream')
  @ApiOperation({ summary: 'ดาวน์โหลดไฟล์รายงานการส่งตรวจ' })
  @ApiParam({ name: 'submissionId', description: 'id ของรายงาน', example: 10 })
  async downloadSubmission(
    @Param('submissionId', ParseIntPipe) submissionId: number,
  ): Promise<StreamableFile> {
    const file = await this.tasksService.openSubmissionFile(submissionId);
    return new StreamableFile(file.stream, {
      type: file.mimeType ?? 'application/octet-stream',
      disposition: contentDisposition(file.fileName),
      length: file.contentLength ?? undefined,
    });
  }

  @Get('submissions/:submissionId/review-file/download')
  @RequirePermission('task.view')
  @ApiProduces('application/octet-stream')
  @ApiOperation({ summary: 'ดาวน์โหลดไฟล์ที่ผู้ตรวจแนบตอนส่งกลับแก้' })
  @ApiParam({ name: 'submissionId', description: 'id ของรายงาน', example: 10 })
  @ApiResponse({ status: 404, description: 'ไม่พบไฟล์แนบของผู้ตรวจ' })
  async downloadReviewFile(
    @Param('submissionId', ParseIntPipe) submissionId: number,
  ): Promise<StreamableFile> {
    const file = await this.tasksService.openReviewFile(submissionId);
    return new StreamableFile(file.stream, {
      type: file.mimeType ?? 'application/octet-stream',
      disposition: contentDisposition(file.fileName),
      length: file.contentLength ?? undefined,
    });
  }

  @Get('reviews')
  @RequirePermission('task.review')
  @ApiOperation({
    summary: 'เมนูงานตรวจ — รอตรวจ / ที่ฉันตรวจไปแล้ว',
    description:
      'หนึ่งแถวต่อรายงานการส่งตรวจหนึ่งรอบ พร้อมงาน โครงการ ผู้ส่ง และผู้ตรวจ ' +
      '?tab=PENDING (ค่าเริ่มต้น) = รอตรวจและฉันมีสิทธิ์ตรวจ เรียงรอนานสุดก่อน · ' +
      '?tab=REVIEWED = ที่ฉันตรวจไปแล้ว เรียงล่าสุดก่อน กรองผลด้วย ?result=APPROVED|REJECTED · ' +
      '?search= ค้นชื่องาน รหัสโครงการ และชื่อโครงการ · ' +
      '?sortBy=projectCode|projectName|taskTitle|submittedAt|reviewedAt คู่กับ ?sortOrder=ASC|DESC',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [TaskReviewItemDto] })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์ตรวจงาน' })
  findReviews(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryTaskReviewsDto,
  ): Promise<PaginatedResult<TaskReviewItemDto>> {
    return this.tasksService.findReviews(query, user);
  }

  @Post(':id/submissions')
  @RequirePermission('task.update')
  @UseInterceptors(FileInterceptor('file', UPLOAD_INTERCEPTOR_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['report'],
      properties: {
        report: { type: 'string', description: 'รายงานผลการทำงาน' },
        actualHours: { type: 'string', description: 'ชั่วโมงที่ใช้จริง' },
        file: {
          type: 'string',
          format: 'binary',
          description: `ไฟล์รายงาน ไม่เกิน ${MAX_UPLOAD_MB} MB — รับ ${[...ALLOWED_EXTENSIONS].join(' ')}`,
        },
      },
    },
  })
  @ApiOperation({ summary: 'บันทึกรายงานผลการทำงานก่อนส่งตรวจ' })
  @ApiParam({ name: 'id', description: 'id ของงาน', example: 5 })
  @ApiResponse({ status: 201, description: 'บันทึกรายงานแล้ว', type: TaskResponseDto })
  async createSubmission(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateTaskSubmissionDto,
    @UploadedFile() file?: UploadedFileLike,
  ): Promise<{ data: TaskResponseDto; message: string }> {
    return {
      data: await this.tasksService.createSubmission(id, dto, file),
      message: 'บันทึกรายงานแล้ว',
    };
  }

  @Get('me')
  @RequirePermission('task.view')
  @ApiOperation({
    summary: 'งานของฉัน',
    description: 'คืนเฉพาะงานที่มอบหมายให้ผู้ใช้ที่ล็อกอินอยู่',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [CompanyTaskResponseDto] })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  findMyTasks(
    @CurrentUser('id') userId: number,
    @Query() query: PaginationDto,
  ): Promise<PaginatedResult<CompanyTaskResponseDto>> {
    return this.tasksService.findMyTasks(userId, query);
  }

  @Get()
  @RequirePermission('task.view')
  @ApiOperation({
    summary: 'M2-07 — รายการงานทั้งบริษัท (ข้ามโครงการ)',
    description:
      'รายการแบบแบน นับงานย่อยทุกชั้นเป็นหนึ่งงาน พร้อมโครงการที่งานสังกัด ' +
      'ใช้เจาะดูจากหน้าจอภาพรวม เช่น ?status=WAITING เพื่อดูว่าอะไรค้างอยู่ ' +
      'เรียงตามวันครบกำหนดใกล้สุดก่อน งานที่ไม่มีวันครบกำหนดอยู่ท้าย',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [CompanyTaskResponseDto] })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  findCompanyTasks(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryCompanyTasksDto,
  ): Promise<PaginatedResult<CompanyTaskResponseDto>> {
    return this.tasksService.findCompanyTasks(query, user);
  }

  @Get('summary')
  @RequirePermission('task.view')
  @ApiOperation({
    summary: 'M2-07 — ภาพรวมงานทั้งบริษัท',
    description:
      'จำนวนงานแยกตามสถานะ งานเกินกำหนดแยกตามสถานะ และภาระงานที่ยังไม่เสร็จของแต่ละคน ' +
      'ใช้ดูว่างานติดขัดอยู่ที่ขั้นตอนไหนและอยู่กับใคร — สถานะที่ไม่มีงานคืนมาเป็น 0',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: TaskBoardSummaryDto })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  summarizeBoard(@Query() query: QueryTaskBoardDto): Promise<TaskBoardSummaryDto> {
    return this.tasksService.summarizeBoard(query);
  }

  @Get('due-soon')
  @RequirePermission('task.view')
  @ApiOperation({
    summary: 'M2-06 — งานใกล้ครบกำหนด',
    description:
      'งานที่ครบกำหนดตั้งแต่วันนี้ถึงอีก withinDays วัน (ค่าเริ่มต้น 7) และยังไม่ใช่ DONE ' +
      'ต่อกับ /api/tasks/overdue พอดี — งานที่ครบกำหนดวันนี้อยู่ในรายการนี้ ยังไม่นับว่าเกินกำหนด',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [TaskResponseDto] })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  findDueSoon(@Query() query: QueryDueSoonTasksDto): Promise<PaginatedResult<TaskResponseDto>> {
    return this.tasksService.findDueSoon(query);
  }

  /**
   * ต้องประกาศก่อน route ที่มี :id ทุกเส้น ไม่งั้นคำว่า "overdue" จะถูกจับเป็นค่าของ :id
   */
  @Get('overdue')
  @RequirePermission('task.view')
  @ApiOperation({
    summary: 'งานที่เกินกำหนด',
    description:
      'งานที่วันครบกำหนดผ่านไปแล้วและสถานะยังไม่ใช่ DONE ' +
      'เรียงงานที่ค้างนานที่สุดขึ้นก่อน แล้วเรียงตามความสำคัญในวันเดียวกัน ' +
      'งานที่ครบกำหนดวันนี้ยังไม่ถือว่าเกิน จนกว่าจะข้ามไปวันถัดไป',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [TaskResponseDto] })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  findOverdue(@Query() query: QueryOverdueTasksDto): Promise<PaginatedResult<TaskResponseDto>> {
    return this.tasksService.findOverdue(query);
  }

  @Get(':id')
  @RequirePermission('task.view')
  @ApiOperation({ summary: 'รายละเอียดงานพร้อมรายงานการส่งตรวจ' })
  @ApiParam({ name: 'id', description: 'id ของงาน', example: 5 })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: TaskResponseDto })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<TaskResponseDto> {
    return this.tasksService.findOne(id);
  }

  @Patch(':id/status')
  @RequirePermission('task.update')
  @ApiOperation({
    summary: 'เปลี่ยนสถานะงาน',
    description:
      'เปลี่ยนไปสถานะใดก็ได้ ระบบไม่บังคับลำดับ เพราะงานจริงถอยกลับได้ ' +
      '(ตรวจแล้วไม่ผ่านต้องกลับไป DOING) เมื่อเป็น DONE ระบบบันทึก completedAt ให้ ' +
      'และล้างค่าเมื่อถอยออกจาก DONE ส่วนการเปลี่ยนเป็น DONE ซ้ำจะไม่ทับเวลาเดิม',
  })
  @ApiParam({ name: 'id', description: 'id ของงาน', example: 5 })
  @ApiResponse({ status: 200, description: 'เปลี่ยนสถานะเรียบร้อย', type: TaskResponseDto })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลงาน' })
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTaskStatusDto,
  ): Promise<{ data: TaskResponseDto; message: string }> {
    return {
      data: await this.tasksService.updateStatus(id, dto),
      message: 'เปลี่ยนสถานะเรียบร้อย',
    };
  }

  @Patch(':id/submit-review')
  @RequirePermission('task.update')
  @ApiOperation({ summary: 'ส่งงานให้ตรวจ' })
  @ApiParam({ name: 'id', description: 'id ของงาน', example: 5 })
  @ApiResponse({ status: 200, description: 'ส่งงานตรวจเรียบร้อย', type: TaskResponseDto })
  async submitForReview(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ data: TaskResponseDto; message: string }> {
    return {
      data: await this.tasksService.submitForReview(id),
      message: 'ส่งงานตรวจเรียบร้อย',
    };
  }

  @Patch(':id/review')
  @RequirePermission('task.review')
  @UseInterceptors(FileInterceptor('file', UPLOAD_INTERCEPTOR_OPTIONS))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['status'],
      properties: {
        status: { type: 'string', enum: ['DONE', 'DOING'] },
        reviewNote: { type: 'string', description: 'สิ่งที่ต้องแก้ไข' },
        file: {
          type: 'string',
          format: 'binary',
          description: `ไฟล์ประกอบจากผู้ตรวจ (ไม่บังคับ) ไม่เกิน ${MAX_UPLOAD_MB} MB`,
        },
      },
    },
  })
  @ApiOperation({
    summary: 'ตรวจงานและอนุมัติหรือส่งกลับแก้ไข',
    description:
      'ส่ง JSON ได้เหมือนเดิม หรือ multipart เมื่อต้องการแนบไฟล์ประกอบ (เช่นภาพจุดที่ต้องแก้) ' +
      'ไฟล์ถูกเก็บที่รายงานรอบนั้น ดาวน์โหลดผ่าน submissions[].reviewDownloadUrl',
  })
  @ApiParam({ name: 'id', description: 'id ของงาน', example: 5 })
  @ApiResponse({ status: 200, description: 'ตรวจงานเรียบร้อย', type: TaskResponseDto })
  async review(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewTaskDto,
    @UploadedFile() file?: UploadedFileLike,
  ): Promise<{ data: TaskResponseDto; message: string }> {
    return {
      data: await this.tasksService.review(id, dto, file),
      message: 'ตรวจงานเรียบร้อย',
    };
  }

  @Patch(':id/order')
  @RequirePermission('task.update')
  @ApiOperation({
    summary: 'จัดลำดับงาน (ลากวาง)',
    description:
      'ส่งตำแหน่งปลายทางที่ต้องการ เริ่มนับที่ 0 ระบบจะเรียงพี่น้องในกลุ่มเดียวกันใหม่ ' +
      'ให้เป็น 0, 1, 2, ... ทั้งกลุ่ม ทำให้ลำดับถูกต้องเสมอไม่ว่าลากไปมากี่รอบ ' +
      'ค่านี้ใช้เพื่อการแสดงผลเท่านั้น ระบบไม่บังคับว่างานไหนต้องเสร็จก่อนงานไหน',
  })
  @ApiParam({ name: 'id', description: 'id ของงาน', example: 5 })
  @ApiResponse({ status: 200, description: 'จัดลำดับเรียบร้อย', type: TaskResponseDto })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลงาน' })
  async updateOrder(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTaskOrderDto,
  ): Promise<{ data: TaskResponseDto; message: string }> {
    return {
      data: await this.tasksService.updateOrder(id, dto),
      message: 'จัดลำดับเรียบร้อย',
    };
  }
}
