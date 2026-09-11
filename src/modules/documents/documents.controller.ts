import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { contentDisposition } from '../files/upload.util';
import { DocumentsService } from './documents.service';
import { UpdateDocumentDto } from './dto/document.dto';
import { DocumentResponseDto } from './dto/document.response';

@ApiTags('documents')
@ApiBearerAuth('access-token')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get(':id')
  @RequirePermission('document.view')
  @ApiOperation({ summary: 'รายละเอียดเอกสาร' })
  @ApiParam({ name: 'id', description: 'id ของเอกสาร', example: 12 })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: DocumentResponseDto })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบเอกสาร' })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<DocumentResponseDto> {
    return this.documentsService.findOne(id);
  }

  @Get(':id/download')
  @RequirePermission('document.view')
  @ApiProduces('application/octet-stream')
  @ApiOperation({
    summary: 'ดาวน์โหลดไฟล์ของเอกสาร',
    description:
      'คืนไฟล์ตรง ๆ (ไม่ใช่ JSON) พร้อม Content-Disposition ที่มีชื่อไฟล์ภาษาไทย — ' +
      'ต้องแนบ Authorization header เหมือนเส้นอื่น ถ้าผิดพลาดยังคืน JSON รูปแบบมาตรฐาน',
  })
  @ApiParam({ name: 'id', description: 'id ของเอกสาร', example: 12 })
  @ApiResponse({ status: 200, description: 'ไฟล์' })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบเอกสาร หรือไม่พบไฟล์ในที่เก็บ' })
  @ApiResponse({ status: 503, description: 'ที่เก็บไฟล์ไม่ตอบสนอง' })
  async download(@Param('id', ParseIntPipe) id: number): Promise<StreamableFile> {
    const file = await this.documentsService.openFile(id);

    return new StreamableFile(file.stream, {
      type: file.mimeType ?? 'application/octet-stream',
      disposition: contentDisposition(file.fileName),
      length: file.contentLength ?? undefined,
    });
  }

  @Patch(':id')
  @RequirePermission('document.update')
  @ApiOperation({
    summary: 'แก้ชื่อหรือรายละเอียดเอกสาร',
    description: 'เปลี่ยนไฟล์ไม่ได้ — ไฟล์ฉบับใหม่ให้อัปโหลดเป็นเอกสารใหม่ ฉบับเก่าจะได้ไม่หายไป',
  })
  @ApiParam({ name: 'id', description: 'id ของเอกสาร', example: 12 })
  @ApiResponse({ status: 200, description: 'บันทึกการแก้ไขเรียบร้อย', type: DocumentResponseDto })
  @ApiResponse({ status: 400, description: 'ข้อมูลไม่ถูกต้อง' })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบเอกสาร' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDocumentDto,
  ): Promise<{ data: DocumentResponseDto; message: string }> {
    return {
      data: await this.documentsService.update(id, dto),
      message: 'บันทึกการแก้ไขเรียบร้อย',
    };
  }

  @Delete(':id')
  @RequirePermission('document.delete')
  @ApiOperation({
    summary: 'ลบเอกสาร',
    description: 'ลบออกจากรายการเท่านั้น (soft delete) — ไฟล์ในที่เก็บยังอยู่เป็นหลักฐาน',
  })
  @ApiParam({ name: 'id', description: 'id ของเอกสาร', example: 12 })
  @ApiResponse({ status: 200, description: 'ลบเอกสารเรียบร้อย' })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบเอกสาร' })
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ data: null; message: string }> {
    await this.documentsService.remove(id);
    return { data: null, message: 'ลบเอกสารเรียบร้อย' };
  }
}
