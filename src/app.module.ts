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
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
