import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

export interface LinePushResult {
  ok: boolean;
  status: number;
  body: string;
}

/**
 * ส่งข้อความผ่าน LINE Messaging API (BR-11 — ภายในบริษัทเท่านั้น)
 *
 * ไม่ใช้ SDK ของ LINE ตั้งใจ — เรียกแค่ push text ที่จำเป็นต่อแจ้งเตือน
 * Channel access token มาจาก env ไม่ hardcode ในโค้ด
 */
@Injectable()
export class LineMessagingService {
  private readonly logger = new Logger(LineMessagingService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    const token = this.config.get<string>('LINE_CHANNEL_ACCESS_TOKEN', '').trim();
    return token.length > 0;
  }

  async pushText(lineUserId: string, text: string): Promise<LinePushResult> {
    const token = this.config.get<string>('LINE_CHANNEL_ACCESS_TOKEN', '').trim();
    if (!token) {
      throw new ServiceUnavailableException(
        'ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN จึงส่งแจ้งเตือนผ่าน LINE ไม่ได้',
      );
    }

    const response = await fetch(LINE_PUSH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: lineUserId,
        messages: [{ type: 'text', text }],
      }),
    });

    const body = await response.text();
    if (!response.ok) {
      this.logger.warn(`LINE push failed status=${response.status} body=${body}`);
    }

    return { ok: response.ok, status: response.status, body };
  }
}
