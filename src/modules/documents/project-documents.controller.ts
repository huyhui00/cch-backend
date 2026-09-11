import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { type PaginatedResult } from '../../common/dto/pagination.dto';
import {
  ALLOWED_EXTENSIONS,
  MAX_UPLOAD_MB,
  UPLOAD_INTERCEPTOR_OPTIONS,
  type UploadedFileLike,
} from '../files/upload.util';
import { DocumentsService } from './documents.service';
import { QueryDocumentsDto, UploadDocumentDto } from './dto/document.dto';
import { DocumentResponseDto } from './dto/document.response';

const ALLOWED_LIST = [...ALLOWED_EXTENSIONS].join(' ');

/** เอกสารของโครงการ — แสดงและเพิ่มจากหน้ารายละเอียดโครงการ (ประชุม 11 ก.ย. — B-5) */
@ApiTags('documents')
@ApiBearerAuth('access-token')
@Controller('projects/:projectId/documents')
export class ProjectDocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  @RequirePermission('document.view')
  @ApiOperation({
    summary: 'รายการเอกสารของโครงการ',
    description: 'เอกสารล่าสุดขึ้นก่อน ค้นจากชื่อเอกสารหรือชื่อไฟล์ด้วย ?search=',
  })
  @ApiParam({ name: 'projectId', description: 'id ของโครงการ', example: 3 })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [DocumentResponseDto] })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลโครงการ' })
  findAll(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Query() query: QueryDocumentsDto,
  ): Promise<PaginatedResult<DocumentResponseDto>> {
    return this.documentsService.findByProject(projectId, query);
  }

  @Post()
  @RequirePermission('document.create')
  @UseInterceptors(FileInterceptor('file', UPLOAD_INTERCEPTOR_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: `ไฟล์ 1 ไฟล์ ไม่เกิน ${MAX_UPLOAD_MB} MB — รับ ${ALLOWED_LIST}`,
        },
        title: { type: 'string', description: 'ชื่อเอกสาร — ไม่ส่งมาใช้ชื่อไฟล์' },
        note: { type: 'string', description: 'รายละเอียดเอกสาร' },
      },
    },
  })
  @ApiOperation({
    summary: 'อัปโหลดเอกสารของโครงการ',
    description:
      'ส่งเป็น multipart/form-data: file (บังคับ), title, note — ไม่ต้องเลือกประเภทเอกสาร ' +
      `ไฟล์ละไม่เกิน ${MAX_UPLOAD_MB} MB รับเฉพาะเอกสาร รูปภาพ และไฟล์บีบอัด ชื่อไฟล์ภาษาไทยได้ ` +
      'ไฟล์เก็บบน Cloudflare R2 แบบ private ดาวน์โหลดผ่าน downloadUrl ที่ตรวจสิทธิ์ทุกครั้ง',
  })
  @ApiParam({ name: 'projectId', description: 'id ของโครงการ', example: 3 })
  @ApiResponse({ status: 201, description: 'อัปโหลดเอกสารเรียบร้อย', type: DocumentResponseDto })
  @ApiResponse({ status: 400, description: 'ไม่ได้แนบไฟล์ ไฟล์ว่าง หรือไม่รับไฟล์ประเภทนี้' })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลโครงการ' })
  @ApiResponse({ status: 413, description: `ไฟล์ใหญ่เกิน ${MAX_UPLOAD_MB} MB` })
  @ApiResponse({
    status: 503,
    description: 'ยังไม่ได้ตั้งค่าที่เก็บไฟล์ หรือที่เก็บไฟล์ไม่ตอบสนอง',
  })
  async upload(
    @Param('projectId', ParseIntPipe) projectId: number,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body() dto: UploadDocumentDto,
  ): Promise<{ data: DocumentResponseDto; message: string }> {
    return {
      data: await this.documentsService.upload(projectId, file, dto),
      message: 'อัปโหลดเอกสารเรียบร้อย',
    };
  }
}
