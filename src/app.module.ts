import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AppController } from './app.controller';
import { AccessControlModule } from './common/access-control.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { createUserOrIpTracker, sharedBucketKey } from './common/throttle/throttle-tracker';
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
import { NavModule } from './modules/nav/nav.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      cache: true,
    }),
    ScheduleModule.forRoot(),
    // นับในหน่วยความจำของโปรเซส — รีสตาร์ทแล้วตัวนับเริ่มใหม่ ซึ่งพอสำหรับเซิร์ฟเวอร์เดียว
    // ล็อกอินแล้วนับต่อผู้ใช้ ยังไม่ล็อกอินนับต่อ IP · ถังเดียวรวมทุกเส้น
    // หน้าจอหนึ่งหน้ายิงหลายเส้นพร้อมกัน (nav/counts, รายการ, ตัวเลือก) ค่ารวมจึงต้องหลวม
    // ส่วนเส้นล็อกอินมีถังแยกที่เข้มกว่าที่ AuthController
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [{ ttl: 60_000, limit: 300 }],
        errorMessage: 'มีคำขอมากเกินไป กรุณารอสักครู่แล้วลองใหม่',
        skipIf: () => process.env.THROTTLE_ENABLED === 'false',
        getTracker: createUserOrIpTracker(config.getOrThrow<string>('JWT_ACCESS_SECRET')),
        generateKey: sharedBucketKey,
      }),
    }),
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
    NavModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [
    // ผูกที่ระดับ global เพื่อให้ "ต้องล็อกอิน" เป็นค่าเริ่มต้นของทุก endpoint
    // module ใหม่ที่เพิ่มใน phase ถัดไปจึงถูกป้องกันทันทีโดยไม่ต้องจำใส่ guard เอง
    // endpoint ที่เข้าถึงได้โดยไม่ต้องมี token ต้องประกาศ @Public() ออกมาให้ชัด
    //
    // ลำดับสำคัญ: ThrottlerGuard มาก่อนสุด เพื่อนับคำขอที่ยังไม่มี token ด้วย (กันเดารหัสผ่าน)
    // JwtAuthGuard ต้องมาก่อน PermissionsGuard เพราะ PermissionsGuard อ่าน request.user
    // ที่ตัวแรกแนบไว้ให้
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
