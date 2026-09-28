import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { WarrantiesService } from './warranties.service';

/**
 * เปลี่ยนประกัน ACTIVE ที่เลยวันสิ้นสุดเป็น EXPIRED — รายชั่วโมง และตอนเปิดเซิร์ฟเวอร์
 * ปิดด้วย SCHEDULER_ENABLED=false เหมือน MaContractExpiryScheduler
 */
@Injectable()
export class WarrantyExpiryScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(WarrantyExpiryScheduler.name);

  constructor(
    private readonly warranties: WarrantiesService,
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
      const expired = await this.warranties.expireEndedWarranties();
      if (expired > 0) {
        this.logger.log(`เปลี่ยนประกันที่เลยวันสิ้นสุดเป็น EXPIRED ${expired} ใบ`);
      }
    } catch (error) {
      this.logger.error('ปรับสถานะประกันที่หมดอายุไม่สำเร็จ', error as Error);
    }
  }

  private isEnabled(): boolean {
    const raw = (this.config.get<string>('SCHEDULER_ENABLED') ?? 'true').trim().toLowerCase();
    return raw !== 'false' && raw !== '0' && raw !== 'off' && raw !== 'no';
  }
}
