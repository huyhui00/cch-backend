import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { NotificationDispatchService } from './notification-dispatch.service';
import {
  type ClockTime,
  DEFAULT_NOTIFY_END,
  DEFAULT_NOTIFY_START,
  isWithinNotifyHours,
  parseClockTime,
} from './notification-digest';

/**
 * เช็คกำหนดส่งทุก 5 นาที แล้วแจ้งรายการที่เพิ่งเข้าช่วงใกล้ครบหรือเพิ่งเลยกำหนด
 * (แต่ละรายการแจ้งครั้งเดียวต่อขั้น — NotificationDispatchService กันไว้ด้วย dedupe_key)
 *
 * ส่งเฉพาะช่วง `NOTIFY_START_TIME`–`NOTIFY_END_TIME` (ค่าเริ่มต้น 08:30–18:00) วันจันทร์–ศุกร์
 * นอกช่วงรายการรอไปส่งรอบแรกของช่วงถัดไป · เสาร์–อาทิตย์เปิดด้วย `NOTIFY_WEEKENDS=true`
 * ปิดได้ด้วย SCHEDULER_ENABLED=false
 */
@Injectable()
export class NotificationSchedulerService {
  private readonly logger = new Logger(NotificationSchedulerService.name);
  private running = false;

  constructor(
    private readonly dispatch: NotificationDispatchService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleTick(): Promise<void> {
    if (this.running || !this.isEnabled()) {
      return;
    }
    const start = this.clock('NOTIFY_START_TIME', DEFAULT_NOTIFY_START);
    const end = this.clock('NOTIFY_END_TIME', DEFAULT_NOTIFY_END);
    if (!isWithinNotifyHours(new Date(), start, end, this.weekends())) {
      return;
    }

    this.running = true;
    try {
      const result = await this.dispatch.runAll();
      if (result.created > 0) {
        this.logger.log(
          `แจ้งกำหนดส่ง created=${result.created} lineSent=${result.lineSent} ` +
            `lineFailed=${result.lineFailed}`,
        );
      }
    } finally {
      this.running = false;
    }
  }

  private clock(name: string, fallback: ClockTime): ClockTime {
    const raw = this.config.get<string>(name);
    const parsed = parseClockTime(raw);
    if (raw && !parsed) {
      this.logger.warn(`${name}="${raw}" ไม่ถูกรูปแบบ HH:MM — ใช้ค่าเริ่มต้น`);
    }
    return parsed ?? fallback;
  }

  private weekends(): boolean {
    return (this.config.get<string>('NOTIFY_WEEKENDS') ?? '').trim().toLowerCase() === 'true';
  }

  private isEnabled(): boolean {
    const raw = (this.config.get<string>('SCHEDULER_ENABLED') ?? 'true').trim().toLowerCase();
    return raw !== 'false' && raw !== '0' && raw !== 'off' && raw !== 'no';
  }
}
