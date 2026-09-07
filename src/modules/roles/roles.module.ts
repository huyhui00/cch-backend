import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { Permission, Role, RolePermission, UserRole } from '../../models';
import { PermissionsController } from './permissions.controller';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  imports: [SequelizeModule.forFeature([Role, Permission, UserRole, RolePermission])],
  controllers: [RolesController, PermissionsController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
