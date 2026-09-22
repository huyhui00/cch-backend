import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { AppController } from './app.controller';
import { AccessControlModule } from './common/access-control.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { DatabaseModule } from './database/database.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { AuthModule } from './modules/auth/auth.module';
import { CustomersModule } from './modules/customers/customers.module';
import { DeliveriesModule } from './modules/deliveries/deliveries.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { FollowUpsModule } from './modules/follow-ups/follow-ups.module';
import { MaModule } from './modules/ma/ma.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ReportsModule } from './modules/reports/reports.module';
import { RolesModule } from './modules/roles/roles.module';
import { SurveysModule } from './modules/surveys/surveys.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { UsersModule } from './modules/users/users.module';
import { WarrantiesModule } from './modules/warranties/warranties.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      cache: true,
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    AccessControlModule,

    AuthModule,
    UsersModule,
    RolesModule,
    AuditLogsModule,
    CustomersModule,
    ProjectsModule,
    WarrantiesModule,
    DeliveriesModule,
    MaModule,
    FollowUpsModule,
    SurveysModule,
    TicketsModule,
    ReportsModule,
    DocumentsModule,
    AttachmentsModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [
    // ผูกที่ระดับ global เพื่อให้ "ต้องล็อกอิน" เป็นค่าเริ่มต้นของทุก endpoint
    // module ใหม่ที่เพิ่มใน phase ถัดไปจึงถูกป้องกันทันทีโดยไม่ต้องจำใส่ guard เอง
    // endpoint ที่เข้าถึงได้โดยไม่ต้องมี token ต้องประกาศ @Public() ออกมาให้ชัด
    //
    // ลำดับสำคัญ: JwtAuthGuard ต้องมาก่อน เพราะ PermissionsGuard อ่าน request.user
    // ที่ตัวแรกแนบไว้ให้
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
