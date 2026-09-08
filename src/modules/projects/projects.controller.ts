import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { type PaginatedResult } from '../../common/dto/pagination.dto';
import { CreateProjectDto, QueryProjectsDto, UpdateProjectDto } from './dto/project.dto';
import { ProjectResponseDto } from './dto/project.response';
import { ProjectsService } from './projects.service';

/**
 * โครงการที่ผูกกับลูกค้า พร้อมมูลค่าสัญญาและกำหนดส่งมอบ
 *
 * ไม่มี DELETE โดยเจตนา — ยังไม่อยู่ในขอบเขตที่ตกลงไว้ โครงการที่ยกเลิกให้เปลี่ยน
 * สถานะเป็น CANCELLED แทน ซึ่งเก็บประวัติไว้ได้ครบกว่าและตรงกับแนวทางของทั้งระบบ
 */
@ApiTags('projects')
@ApiBearerAuth('access-token')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  @RequirePermission('project.view')
  @ApiOperation({
    summary: 'รายการโครงการ',
    description: 'กรองตามสถานะ ลูกค้า ความสำคัญ หรือผู้จัดการโครงการได้',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [ProjectResponseDto] })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  findAll(@Query() query: QueryProjectsDto): Promise<PaginatedResult<ProjectResponseDto>> {
    return this.projectsService.findAll(query);
  }

  @Get(':id')
  @RequirePermission('project.view')
  @ApiOperation({
    summary: 'รายละเอียดโครงการ พร้อมสรุปความคืบหน้า',
    description:
      'คืน progress มาด้วย ประกอบด้วยจำนวนงานทั้งหมด งานที่เสร็จ เปอร์เซ็นต์ความคืบหน้า ' +
      'จำนวนงานที่เกินกำหนด และจำนวนงานแยกตามสถานะ ' +
      'เปอร์เซ็นต์ = (งานที่ DONE / งานทั้งหมด) x 100 นับงานทุกชั้นแบบแบน',
  })
  @ApiParam({ name: 'id', description: 'id ของโครงการ', example: 1 })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: ProjectResponseDto })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลโครงการ' })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<ProjectResponseDto> {
    return this.projectsService.findOne(id);
  }

  @Post()
  @RequirePermission('project.create')
  @ApiOperation({
    summary: 'สร้างโครงการ',
    description:
      'ระบุ contractValue และ functionCount ไว้ใช้คิดราคา MA ภายหลัง — ' +
      'เนื้อหาแผน MA เหมือนกันทุกโครงการ แต่ราคาต่างกันตามขนาดงาน (BR-05)',
  })
  @ApiResponse({ status: 201, description: 'สร้างโครงการเรียบร้อย', type: ProjectResponseDto })
  @ApiResponse({
    status: 400,
    description: 'ข้อมูลไม่ถูกต้อง หรือระบุลูกค้า/ผู้จัดการที่ใช้ไม่ได้',
  })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 409, description: 'รหัสโครงการนี้ถูกใช้ไปแล้ว' })
  async create(
    @Body() dto: CreateProjectDto,
  ): Promise<{ data: ProjectResponseDto; message: string }> {
    return { data: await this.projectsService.create(dto), message: 'สร้างโครงการเรียบร้อย' };
  }

  @Put(':id')
  @RequirePermission('project.update')
  @ApiOperation({
    summary: 'แก้ไขโครงการ',
    description: 'ย้ายโครงการไปลูกค้ารายอื่นไม่ได้ เพราะ ticket และสัญญา MA ผูกกับลูกค้าเดิมไปแล้ว',
  })
  @ApiParam({ name: 'id', description: 'id ของโครงการ', example: 1 })
  @ApiResponse({ status: 200, description: 'บันทึกการแก้ไขเรียบร้อย', type: ProjectResponseDto })
  @ApiResponse({ status: 400, description: 'ข้อมูลไม่ถูกต้อง หรือพยายามย้ายลูกค้า' })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลโครงการ' })
  @ApiResponse({ status: 409, description: 'รหัสโครงการนี้ถูกใช้ไปแล้ว' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProjectDto,
  ): Promise<{ data: ProjectResponseDto; message: string }> {
    return {
      data: await this.projectsService.update(id, dto),
      message: 'บันทึกการแก้ไขเรียบร้อย',
    };
  }
}
