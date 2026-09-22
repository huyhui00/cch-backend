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
      get: jest.fn((_key: string, fallback = '') => token || fallback),
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
      text: async () => '{}',
    }) as unknown as typeof fetch;

    const result = await serviceWithToken('tok-abc').pushText('Uxyz', 'สวัสดี');

    expect(result.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.line.me/v2/bot/message/push',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer tok-abc',
        }),
      }),
    );
  });
});
