import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { PermissionGroupDto } from './dto/role.response';
import { RolesService } from './roles.service';

/**
 * รายการสิทธิ์ทั้งหมดสำหรับหน้าติ๊กสิทธิ์
 * อยู่คู่กับ RolesController เพราะใช้เฉพาะในหน้าจัดการบทบาท
 * จึงจำกัดไว้ที่ SUPER_ADMIN เหมือนกัน (BR-10)
 */
@ApiTags('permissions')
@ApiBearerAuth('access-token')
@RequirePermission('role.manage')
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @ApiOperation({
    summary: 'รายการสิทธิ์ทั้งหมดในระบบ',
    description:
      'จัดกลุ่มตาม module มาให้แล้ว พร้อมธง superAdminOnly สำหรับสิทธิ์ที่ติ๊กให้บทบาทไม่ได้ ' +
      'เป็น master data ที่มาจาก seeder ไม่มี endpoint สำหรับเพิ่มหรือแก้ไข',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [PermissionGroupDto] })
  @ApiResponse({ status: 403, description: 'เฉพาะผู้ดูแลระบบสูงสุดเท่านั้นที่จัดการส่วนนี้ได้' })
  findAll(): Promise<PermissionGroupDto[]> {
    return this.rolesService.findAllPermissions();
  }
}
