import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { Role, User, UserRole, UserSession } from '../../models';
import { AuthModule } from '../auth/auth.module';
import { FilesModule } from '../files/files.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    SequelizeModule.forFeature([User, Role, UserRole, UserSession]),
    AuthModule,
    FilesModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
