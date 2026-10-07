/// <reference types="jest" />

import { JwtService } from '@nestjs/jwt';
import type { ExecutionContext } from '@nestjs/common';

import {
  createUserOrIpTracker,
  ipTracker,
  loginBucketKey,
  sharedBucketKey,
} from './throttle-tracker';

const SECRET = 'test-access-secret';
const jwt = new JwtService();
const context = {} as ExecutionContext;

function req(authorization?: string) {
  return { ip: '203.0.113.7', headers: authorization ? { authorization } : {} };
}

describe('throttle tracker', () => {
  const tracker = createUserOrIpTracker(SECRET);

  it('token ที่เซ็นถูกต้องนับต่อผู้ใช้', () => {
    const token = jwt.sign({ sub: 42, username: 'a', accountType: 'USER' }, { secret: SECRET });
    expect(tracker(req(`Bearer ${token}`), context)).toBe('user:42');
  });

  it('ไม่มี token นับต่อ IP', () => {
    expect(tracker(req(), context)).toBe('ip:203.0.113.7');
  });

  it('token ที่เซ็นด้วย secret อื่น (ปลอม sub) นับต่อ IP ไม่ได้ถังใหม่', () => {
    const forged = jwt.sign({ sub: 999, username: 'x', accountType: 'USER' }, { secret: 'other' });
    expect(tracker(req(`Bearer ${forged}`), context)).toBe('ip:203.0.113.7');
  });

  it('token หมดอายุนับต่อ IP', () => {
    const expired = jwt.sign(
      { sub: 42, username: 'a', accountType: 'USER' },
      { secret: SECRET, expiresIn: -10 },
    );
    expect(tracker(req(`Bearer ${expired}`), context)).toBe('ip:203.0.113.7');
  });

  it('header ที่ไม่ใช่ Bearer นับต่อ IP', () => {
    expect(tracker(req('Basic abc'), context)).toBe('ip:203.0.113.7');
  });

  it('ล็อกอินนับต่อ IP เสมอ แม้แนบ token ที่ถูกต้อง', () => {
    const token = jwt.sign({ sub: 42, username: 'a', accountType: 'USER' }, { secret: SECRET });
    expect(ipTracker(req(`Bearer ${token}`), context)).toBe('ip:203.0.113.7');
  });

  it('ถังรวมไม่ขึ้นกับเส้น ส่วนถังล็อกอินแยกออกมา', () => {
    const a = { getClass: () => 'A', getHandler: () => 'a' } as unknown as ExecutionContext;
    const b = { getClass: () => 'B', getHandler: () => 'b' } as unknown as ExecutionContext;

    expect(sharedBucketKey(a, 'user:1', 'default')).toBe(sharedBucketKey(b, 'user:1', 'default'));
    expect(loginBucketKey(a, 'ip:1', 'default')).not.toBe(sharedBucketKey(a, 'ip:1', 'default'));
  });
});
