import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { MaContractsService } from './ma-contracts.service';

/**
 * เปลี่ยนสัญญา ACTIVE ที่เลยวันสิ้นสุดเป็น EXPIRED — รายชั่วโมง และตอนเปิดเซิร์ฟเวอร์
 * ปิดด้วย SCHEDULER_ENABLED=false เหมือน NotificationSchedulerService
 */
@Injectable()
export class MaContractExpiryScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(MaContractExpiryScheduler.name);

  constructor(
    private readonly contracts: MaContractsService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    void this.run();
  }

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    try {
      const expired = await this.contracts.expireEndedContracts();
      if (expired > 0) {
        this.logger.log(`เปลี่ยนสัญญา MA ที่เลยวันสิ้นสุดเป็น EXPIRED ${expired} ฉบับ`);
      }
    } catch (error) {
      this.logger.error('ปรับสถานะสัญญา MA ที่หมดอายุไม่สำเร็จ', error as Error);
    }
  }

  private isEnabled(): boolean {
    const raw = (this.config.get<string>('SCHEDULER_ENABLED') ?? 'true').trim().toLowerCase();
    return raw !== 'false' && raw !== '0' && raw !== 'off' && raw !== 'no';
  }
}
