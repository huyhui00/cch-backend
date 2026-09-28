/// <reference types="jest" />

import { MaContractStatus } from '../../models';
import { deriveContractStatus } from './contract-status.util';

describe('deriveContractStatus', () => {
  const today = '2026-09-28';

  it('ACTIVE ที่วันสิ้นสุดผ่านไปแล้ว → EXPIRED', () => {
    expect(deriveContractStatus(MaContractStatus.ACTIVE, '2026-09-27', today)).toBe(
      MaContractStatus.EXPIRED,
    );
  });

  it('วันสิ้นสุด = วันนี้ ยังคุ้มครอง (นับรวมวันสุดท้าย)', () => {
    expect(deriveContractStatus(MaContractStatus.ACTIVE, today, today)).toBe(
      MaContractStatus.ACTIVE,
    );
  });

  it('EXPIRED ที่ถูกขยายวันสิ้นสุด → ACTIVE', () => {
    expect(deriveContractStatus(MaContractStatus.EXPIRED, '2027-01-01', today)).toBe(
      MaContractStatus.ACTIVE,
    );
  });

  it('DRAFT / CANCELLED / RENEWED ไม่ถูกแตะแม้เลยวันสิ้นสุด', () => {
    for (const status of [
      MaContractStatus.DRAFT,
      MaContractStatus.CANCELLED,
      MaContractStatus.RENEWED,
    ]) {
      expect(deriveContractStatus(status, '2020-01-01', today)).toBe(status);
    }
  });
});
