import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { type PaginatedResult } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { QueryQuotaDto } from '../ma/dto/ma-contract.dto';
import { ProjectMaQuotaSummaryDto } from '../ma/dto/ma.response';
import { MaContractsService } from '../ma/ma-contracts.service';
import {
  CreateProjectDto,
  QueryProjectOptionsDto,
  QueryProjectsDto,
  UpdateProjectDto,
} from './dto/project.dto';
import { ProjectOptionDto, ProjectReportDto, ProjectResponseDto } from './dto/project.response';
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
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly maContractsService: MaContractsService,
  ) {}

  @Get()
  @RequirePermission('project.view')
  @ApiOperation({
    summary: 'รายการโครงการ',
    description:
      'กรองตามสถานะ ลูกค้า ความสำคัญ หรือผู้จัดการโครงการได้ · `sortBy` = code / name / status / ' +
      'priority / startDate / targetEndDate / contractValue / createdAt / updatedAt / ' +
      'customerName / managerName / progress',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [ProjectResponseDto] })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  findAll(@Query() query: QueryProjectsDto): Promise<PaginatedResult<ProjectResponseDto>> {
    return this.projectsService.findAll(query);
  }

  @Get('options')
  @RequirePermission('project.view')
  @ApiOperation({
    summary: 'ตัวเลือกโครงการสำหรับดรอปดาวน์ / ตัวกรอง',
    description:
      'คืนทุกโครงการ (ทุกสถานะ) ไม่แบ่งหน้า เรียงตามชื่อ มีแค่ id / code / name / status ' +
      '— ใช้แทน GET /projects?limit=100 ที่ตัวเลือกจะหายเมื่อเกิน 100 โครงการ · ' +
      'ดรอปดาวน์แบบพิมพ์ค้นส่ง `search` + `limit` (เช่น 20) เพื่อไม่ต้องโหลดทุกโครงการเมื่อข้อมูลเยอะ',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [ProjectOptionDto] })
  @ApiResponse({ status: 400, description: 'search / limit ไม่ถูกต้อง' })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  findOptions(@Query() query: QueryProjectOptionsDto): Promise<ProjectOptionDto[]> {
    return this.projectsService.findOptions(query);
  }

  @Get(':id/report')
  @RequirePermission('project.view')
  @ApiOperation({
    summary: 'B-6 — สรุปตัวเลขรายงานของโปรเจคนี้',
    description:
      'ใช้วาดบล็อก「รายงานของโปรเจคนี้」บนหน้ารายละเอียด — ความคืบหน้า (สูตรเดียวกับ ' +
      'GET /projects/:id) + จำนวนใบแจ้งปัญหา + จำนวนใบส่งมอบ + จำนวนสัญญา MA ' +
      'นับแถวที่ยังไม่ soft delete ของโปรเจคนี้ ไม่กรองสถานะย่อย',
  })
  @ApiParam({ name: 'id', description: 'id ของโครงการ', example: 1 })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: ProjectReportDto })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลโครงการ' })
  getReport(@Param('id', ParseIntPipe) id: number): Promise<ProjectReportDto> {
    return this.projectsService.getReport(id);
  }

  @Get(':id/ma-quota')
  @RequirePermission('ma.view')
  @ApiOperation({
    summary: 'สรุปโควตา MA ของโปรเจคนี้',
    description:
      'ประชุมทบทวนระบบ: การใช้โควตา/ครั้งที่เหลือให้ดูที่โปรเจค ไม่ยัดในหน้ารายการสัญญา ' +
      'คืนสัญญาทุกฉบับของโปรเจคนี้พร้อมสถานะโควตารอบปัจจุบัน ' +
      '(สูตรเดียวกับ GET /ma-contracts/:id/quota) — หน้าจออ่าน contract.isCurrentlyActive ' +
      'กับ quota.remaining / isExhausted · ยังเป็นถังเดียว (bug) ตามที่พัก Q19 ไว้',
  })
  @ApiParam({ name: 'id', description: 'id ของโครงการ', example: 1 })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: ProjectMaQuotaSummaryDto })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลโครงการ' })
  getMaQuota(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: QueryQuotaDto,
  ): Promise<ProjectMaQuotaSummaryDto> {
    return this.maContractsService.listQuotaForProject(
      id,
      query.onDate ? new Date(query.onDate) : undefined,
    );
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
    summary: 'สร้างโครงการ — กับลูกค้าเดิม หรือพร้อมลูกค้าใหม่ในครั้งเดียว',
    description:
      'ส่ง customerId (ลูกค้าเดิม) หรือ newCustomer (ลูกค้าใหม่ ฟิลด์เหมือน POST /api/customers) ' +
      'อย่างใดอย่างหนึ่ง — ลูกค้าใหม่ถูกบันทึกพร้อมโครงการในทรานแซกชันเดียว และต้องมีสิทธิ์ ' +
      'customer.create เพิ่มจาก project.create (ประชุม 11 ก.ย. "ทำงานครั้งเดียวจบ") ' +
      'ระบุ contractValue และ functionCount ไว้ใช้คิดราคา MA ภายหลัง (BR-05)',
  })
  @ApiResponse({ status: 201, description: 'สร้างโครงการเรียบร้อย', type: ProjectResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'ข้อมูลไม่ถูกต้อง ไม่ได้ระบุลูกค้า ส่งมาทั้ง customerId และ newCustomer ' +
      'หรือระบุลูกค้า/ผู้จัดการที่ใช้ไม่ได้',
  })
  @ApiResponse({
    status: 403,
    description: 'ไม่มีสิทธิ์สร้างโครงการ หรือส่ง newCustomer มาแต่ไม่มีสิทธิ์เพิ่มลูกค้า',
  })
  @ApiResponse({ status: 409, description: 'รหัสโครงการหรือรหัสลูกค้าถูกใช้ไปแล้ว' })
  async create(
    @Body() dto: CreateProjectDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ data: ProjectResponseDto; message: string }> {
    return {
      data: await this.projectsService.create(dto, user),
      message: dto.newCustomer ? 'สร้างโครงการพร้อมลูกค้าใหม่เรียบร้อย' : 'สร้างโครงการเรียบร้อย',
    };
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
