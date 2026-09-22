import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { NotificationDispatchService } from './notification-dispatch.service';

/**
 * รันตรวจเหตุการณ์แจ้งเตือนเป็นระยะ
 *
 * ปิดได้ด้วย SCHEDULER_ENABLED=false ใน .env (ค่าเริ่มต้นถือว่าเปิด
 * ยกเว้นตั้งเป็น false / 0 / off โดยเจตนา)
 */
@Injectable()
export class NotificationSchedulerService {
  private readonly logger = new Logger(NotificationSchedulerService.name);

  constructor(
    private readonly dispatch: NotificationDispatchService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleHourly(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    this.logger.log('เริ่มรอบตรวจแจ้งเตือนตามตาราง');
    const result = await this.dispatch.runAll();
    this.logger.log(
      `จบรอบแจ้งเตือน rules=${result.rulesProcessed} created=${result.created} ` +
        `lineSent=${result.lineSent} lineFailed=${result.lineFailed} skipDup=${result.skippedDuplicate}`,
    );
  }

  private isEnabled(): boolean {
    const raw = (this.config.get<string>('SCHEDULER_ENABLED') ?? 'true').trim().toLowerCase();
    return raw !== 'false' && raw !== '0' && raw !== 'off' && raw !== 'no';
  }
}
