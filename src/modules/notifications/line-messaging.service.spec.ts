/// <reference types="jest" />

import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { LineMessagingService } from './line-messaging.service';

describe('LineMessagingService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  function serviceWithToken(token: string): LineMessagingService {
    const config = {
      get: jest.fn((_key: string, fallback: string = ''): string => token || fallback),
    } as unknown as ConfigService;
    return new LineMessagingService(config);
  }

  it('isConfigured เป็น false เมื่อไม่มี token', () => {
    expect(serviceWithToken('').isConfigured()).toBe(false);
  });

  it('pushText โยน 503 เมื่อไม่มี token', async () => {
    await expect(serviceWithToken('').pushText('U1', 'hi')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('pushText เรียก LINE API ด้วย Bearer token', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{}'),
    });

    const result = await serviceWithToken('tok-abc').pushText('Uxyz', 'สวัสดี');

    expect(result.ok).toBe(true);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string> },
    ];
    expect(url).toBe('https://api.line.me/v2/bot/message/push');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok-abc');
  });
});
