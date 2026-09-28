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

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import {
  ALLOWED_EXTENSIONS,
  MAX_UPLOAD_MB,
  UPLOAD_INTERCEPTOR_OPTIONS,
  contentDisposition,
  type UploadedFileLike,
} from '../files/upload.util';
import { AttachmentsService } from './attachments.service';
import {
  QueryAttachmentsDto,
  UpdateAttachmentDto,
  UPLOADABLE_ATTACHMENT_REF_TYPES,
  UploadAttachmentDto,
} from './dto/attachment.dto';
import { AttachmentResponseDto } from './dto/attachment.response';

const ALLOWED_LIST = [...ALLOWED_EXTENSIONS].join(' ');

/**
 * ไฟล์แนบทั่วไป (Phase 9 ส่วนที่เหลือ)
 *
 * บันทึกการติดต่อ (BR-02) · สแกนสัญญา MA (BR-12) · ใบส่งมอบ · ใบแจ้งปัญหา / รอบแก้ · ใบประกัน
 * เอกสารโปรเจคยังใช้ /api/projects/:id/documents ตามเดิม
 */
@ApiTags('attachments')
@ApiBearerAuth('access-token')
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Get()
  @RequirePermission('file.view')
  @ApiOperation({
    summary: 'รายการไฟล์แนบของต้นทาง',
    description: 'ต้องระบุ refType กับ refId เช่น COMMUNICATION_LOG + id บันทึกการติดต่อ',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [AttachmentResponseDto] })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบต้นทางของไฟล์แนบ' })
  findAll(@Query() query: QueryAttachmentsDto): Promise<AttachmentResponseDto[]> {
    return this.attachmentsService.findAll(query);
  }

  @Get(':id')
  @RequirePermission('file.view')
  @ApiOperation({ summary: 'รายละเอียดไฟล์แนบ' })
  @ApiParam({ name: 'id', description: 'id ของไฟล์แนบ', example: 12 })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: AttachmentResponseDto })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบไฟล์แนบ' })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<AttachmentResponseDto> {
    return this.attachmentsService.findOne(id);
  }

  @Get(':id/download')
  @RequirePermission('file.view', 'file.download')
  @ApiProduces('application/octet-stream')
  @ApiOperation({
    summary: 'ดาวน์โหลดไฟล์แนบ',
    description:
      'คืนไฟล์ตรง ๆ (ไม่ใช่ JSON) พร้อม Content-Disposition ที่มีชื่อไฟล์ภาษาไทย — ' +
      'ต้องแนบ Authorization header',
  })
  @ApiParam({ name: 'id', description: 'id ของไฟล์แนบ', example: 12 })
  @ApiResponse({ status: 200, description: 'ไฟล์' })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบไฟล์แนบ หรือไม่พบไฟล์ในที่เก็บ' })
  @ApiResponse({ status: 503, description: 'ที่เก็บไฟล์ไม่ตอบสนอง' })
  async download(@Param('id', ParseIntPipe) id: number): Promise<StreamableFile> {
    const file = await this.attachmentsService.openFile(id);

    return new StreamableFile(file.stream, {
      type: file.mimeType ?? 'application/octet-stream',
      disposition: contentDisposition(file.fileName),
      length: file.contentLength ?? undefined,
    });
  }

  @Post()
  @RequirePermission('file.upload')
  @UseInterceptors(FileInterceptor('file', UPLOAD_INTERCEPTOR_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'refType', 'refId'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: `ไฟล์ 1 ไฟล์ ไม่เกิน ${MAX_UPLOAD_MB} MB — รับ ${ALLOWED_LIST}`,
        },
        refType: {
          type: 'string',
          enum: [...UPLOADABLE_ATTACHMENT_REF_TYPES],
          description: 'ประเภทต้นทาง',
        },
        refId: { type: 'integer', description: 'id ของต้นทาง' },
        note: { type: 'string', description: 'หมายเหตุประกอบไฟล์' },
      },
    },
  })
  @ApiOperation({
    summary: 'อัปโหลดไฟล์แนบ',
    description:
      'multipart/form-data: file + refType + refId (+ note) — ' +
      'สัญญา MA จะอัปเดต signed_file_url ให้ด้วย (BR-12) · ' +
      'เอกสารโปรเจคใช้ POST /api/projects/:id/documents',
  })
  @ApiResponse({ status: 201, description: 'อัปโหลดไฟล์แนบเรียบร้อย', type: AttachmentResponseDto })
  @ApiResponse({ status: 400, description: 'ไม่ได้แนบไฟล์ หรือ refType ไม่ถูกต้อง' })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบต้นทางของไฟล์แนบ' })
  @ApiResponse({ status: 413, description: `ไฟล์ใหญ่เกิน ${MAX_UPLOAD_MB} MB` })
  @ApiResponse({
    status: 503,
    description: 'ยังไม่ได้ตั้งค่าที่เก็บไฟล์ หรือที่เก็บไฟล์ไม่ตอบสนอง',
  })
  async upload(
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body() dto: UploadAttachmentDto,
  ): Promise<{ data: AttachmentResponseDto; message: string }> {
    return {
      data: await this.attachmentsService.upload(file, dto),
      message: 'อัปโหลดไฟล์แนบเรียบร้อย',
    };
  }

  @Patch(':id')
  @RequirePermission('file.upload')
  @ApiOperation({
    summary: 'แก้หมายเหตุไฟล์แนบ',
    description: 'เปลี่ยนไฟล์ไม่ได้ — ไฟล์ฉบับใหม่ให้อัปโหลดใหม่',
  })
  @ApiParam({ name: 'id', description: 'id ของไฟล์แนบ', example: 12 })
  @ApiResponse({ status: 200, description: 'บันทึกการแก้ไขเรียบร้อย', type: AttachmentResponseDto })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบไฟล์แนบ' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAttachmentDto,
  ): Promise<{ data: AttachmentResponseDto; message: string }> {
    return {
      data: await this.attachmentsService.update(id, dto),
      message: 'บันทึกการแก้ไขเรียบร้อย',
    };
  }

  @Delete(':id')
  @RequirePermission('file.delete')
  @ApiOperation({
    summary: 'ลบไฟล์แนบ',
    description: 'ลบออกจากรายการเท่านั้น (soft delete) — ไฟล์ในที่เก็บยังอยู่เป็นหลักฐาน',
  })
  @ApiParam({ name: 'id', description: 'id ของไฟล์แนบ', example: 12 })
  @ApiResponse({ status: 200, description: 'ลบไฟล์แนบเรียบร้อย' })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบไฟล์แนบ' })
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ data: null; message: string }> {
    await this.attachmentsService.remove(id);
    return { data: null, message: 'ลบไฟล์แนบเรียบร้อย' };
  }
}
