import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { type PaginatedResult } from '../../common/dto/pagination.dto';
import {
  CreateMaAddonDto,
  CreateMaContractDto,
  QueryMaContractsDto,
  QueryQuotaDto,
  RenewMaContractDto,
  UpdateMaContractDto,
} from './dto/ma-contract.dto';
import {
  MaAddonResponseDto,
  MaContractResponseDto,
  QuotaStatusResponseDto,
} from './dto/ma.response';
import { MaContractsService } from './ma-contracts.service';

/**
 * สัญญา MA — ที่อยู่ของ "ราคา" ตาม BR-05
 *
 * ไม่มี DELETE โดยเจตนา สัญญาที่ไม่เอาแล้วให้เปลี่ยนสถานะเป็น CANCELLED
 * เหตุผลเดียวกับโครงการใน Phase 5 และใบส่งมอบใน Phase 6 — เป็นเอกสารที่เกิดขึ้นจริง
 * และมีประวัติการหักโควตาผูกอยู่ ถ้าลบได้ ประวัติจะไร้ที่มา
 */
@ApiTags('ma-contracts')
@ApiBearerAuth('access-token')
@Controller('ma-contracts')
export class MaContractsController {
  constructor(private readonly contractsService: MaContractsService) {}

  @Get()
  @RequirePermission('ma.view')
  @ApiOperation({
    summary: 'รายการสัญญา MA',
    description:
      'กรองตามลูกค้า โครงการ หรือสถานะได้ และใช้ ?expiringInDays=30 สำหรับหน้าจอ ' +
      '"สัญญาใกล้หมดอายุ" ซึ่งนับเฉพาะฉบับที่ยัง ACTIVE และยังไม่เลยวันหมดอายุ',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [MaContractResponseDto] })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  findAll(@Query() query: QueryMaContractsDto): Promise<PaginatedResult<MaContractResponseDto>> {
    return this.contractsService.findAll(query);
  }

  @Get(':id')
  @RequirePermission('ma.view')
  @ApiOperation({
    summary: 'รายละเอียดสัญญา พร้อมของเสริมและสถานะโควตาของรอบปัจจุบัน',
    description:
      'รอบโควตานับจากวันเริ่มสัญญา ไม่ใช่เดือนปฏิทิน — ดู quota.periodStart / quota.periodEnd ' +
      'เพื่อรู้ว่ารอบนี้ครอบวันไหนถึงวันไหน',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: MaContractResponseDto })
  @ApiResponse({ status: 404, description: 'ไม่พบสัญญา MA นี้' })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<MaContractResponseDto> {
    return this.contractsService.findOne(id);
  }

  @Get(':id/quota')
  @RequirePermission('ma.view')
  @ApiOperation({
    summary: 'สถานะโควตาของสัญญา',
    description:
      'ไม่ระบุ onDate = รอบปัจจุบัน ระบุได้เพื่อดูรอบย้อนหลัง — ' +
      'โควตาที่เหลือไม่ยกยอดไปรอบถัดไป',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: QuotaStatusResponseDto })
  @ApiResponse({ status: 404, description: 'ไม่พบสัญญา MA นี้' })
  getQuota(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: QueryQuotaDto,
  ): Promise<QuotaStatusResponseDto> {
    return this.contractsService.getQuota(id, query.onDate ? new Date(query.onDate) : undefined);
  }

  @Get(':id/addons')
  @RequirePermission('ma.view')
  @ApiOperation({ summary: 'รายการของเสริมของสัญญา' })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [MaAddonResponseDto] })
  @ApiResponse({ status: 404, description: 'ไม่พบสัญญา MA นี้' })
  listAddons(@Param('id', ParseIntPipe) id: number): Promise<MaAddonResponseDto[]> {
    return this.contractsService.listAddons(id);
  }

  @Post()
  @RequirePermission('ma.create')
  @ApiOperation({
    summary: 'สร้างสัญญา MA',
    description:
      'ลูกค้าถูกดึงมาจากโครงการให้เอง จึงไม่ต้องส่ง customerId — ' +
      'ถ้าโครงการมีสัญญา ACTIVE ที่ช่วงเวลาทับกันอยู่ ระบบยังบันทึกให้ แต่จะเตือนใน message',
  })
  @ApiResponse({ status: 201, description: 'สร้างสัญญาเรียบร้อย', type: MaContractResponseDto })
  @ApiResponse({ status: 400, description: 'ช่วงวันไม่ถูกต้อง หรือแผนถูกปิดใช้งาน' })
  @ApiResponse({ status: 404, description: 'ไม่พบโครงการหรือแผนที่ระบุ' })
  @ApiResponse({ status: 409, description: 'เลขที่สัญญาซ้ำ' })
  async create(
    @Body() dto: CreateMaContractDto,
  ): Promise<{ data: MaContractResponseDto; message: string }> {
    const { contract, warning } = await this.contractsService.create(dto);

    return { data: contract, message: warning ?? 'สร้างสัญญา MA เรียบร้อย' };
  }

  @Patch(':id')
  @RequirePermission('ma.update')
  @ApiOperation({
    summary: 'แก้ไขสัญญา MA',
    description:
      'ย้ายโครงการไม่ได้ และเมื่อสัญญาหักโควตาไปแล้วจะแก้วันเริ่มสัญญาหรือแผนไม่ได้อีก ' +
      'เพราะทั้งสองค่าเป็นตัวกำหนดว่าประวัติการใช้โควตาตกรอบไหนและรอบนั้นมีโควตาเท่าไหร่',
  })
  @ApiResponse({ status: 200, description: 'แก้ไขเรียบร้อย', type: MaContractResponseDto })
  @ApiResponse({ status: 400, description: 'ช่วงวันไม่ถูกต้อง หรือตั้งสถานะ RENEWED เอง' })
  @ApiResponse({ status: 409, description: 'แก้ค่าที่กระทบประวัติการหักโควตา หรือเลขที่สัญญาซ้ำ' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMaContractDto,
  ): Promise<{ data: MaContractResponseDto; message: string }> {
    return {
      data: await this.contractsService.update(id, dto),
      message: 'แก้ไขสัญญา MA เรียบร้อย',
    };
  }

  @Post(':id/renew')
  @RequirePermission('ma.renew')
  @ApiOperation({
    summary: 'ต่อสัญญา',
    description:
      'สร้างฉบับใหม่ที่ชี้กลับไปหาฉบับเดิมผ่าน previousContractId แล้วปิดฉบับเดิมเป็น RENEWED ' +
      'ในทรานแซกชันเดียว ฉบับใหม่เริ่มที่ DRAFT เสมอเพราะยังไม่ได้เซ็น (BR-12)',
  })
  @ApiResponse({ status: 201, description: 'ต่อสัญญาเรียบร้อย', type: MaContractResponseDto })
  @ApiResponse({ status: 400, description: 'สัญญาที่ยกเลิกแล้วต่อไม่ได้ หรือช่วงวันไม่ถูกต้อง' })
  @ApiResponse({ status: 409, description: 'สัญญาฉบับนี้ถูกต่อไปแล้ว' })
  async renew(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RenewMaContractDto,
  ): Promise<{ data: MaContractResponseDto; message: string }> {
    return { data: await this.contractsService.renew(id, dto), message: 'ต่อสัญญาเรียบร้อย' };
  }

  @Post(':id/addons')
  @RequirePermission('ma.update')
  @ApiOperation({
    summary: 'เพิ่มของเสริมให้สัญญา',
    description:
      'โควตาจาก addon ถูกบวกกับโควตาของแผนตอนคำนวณ — ระบุ effectiveYear คู่กับ ' +
      'effectiveMonth เพื่อให้มีผลเฉพาะรอบนั้น หรือไม่ระบุทั้งคู่เพื่อให้มีผลตลอดอายุสัญญา',
  })
  @ApiResponse({ status: 201, description: 'เพิ่มของเสริมเรียบร้อย', type: MaAddonResponseDto })
  @ApiResponse({ status: 400, description: 'ระบุปีหรือเดือนมาไม่ครบคู่ หรือสัญญาถูกยกเลิกแล้ว' })
  @ApiResponse({ status: 404, description: 'ไม่พบสัญญา MA นี้' })
  async createAddon(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateMaAddonDto,
  ): Promise<{ data: MaAddonResponseDto; message: string }> {
    return {
      data: await this.contractsService.createAddon(id, dto),
      message: 'เพิ่มของเสริมเรียบร้อย',
    };
  }
}
