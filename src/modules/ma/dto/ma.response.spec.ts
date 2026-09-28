/// <reference types="jest" />

import { MaContractStatus } from '../../../models';
import {
  MaContractCoverageState,
  isContractCurrentlyActive,
  resolveContractCoverageState,
  toMaContractResponse,
} from './ma.response';

function contract(overrides: Record<string, unknown> = {}) {
  return {
    id: 2,
    customerId: 1,
    customer: { name: 'Detroit' },
    projectId: 2,
    project: { name: 'Detroit Become:Human' },
    planId: 3,
    plan: {
      id: 3,
      code: 'MA_PREMIUM',
      name: 'MA Premium',
      bugQuotaPerMonth: 20,
      responseTimeHour: 4,
    },
    contractNo: 'MA-2026-002',
    price: '180000.00',
    billingCycle: 'YEARLY',
    startDate: '2026-10-01',
    endDate: '2027-10-01',
    status: MaContractStatus.ACTIVE,
    signedDate: null,
    signedFileUrl: null,
    previousContractId: null,
    note: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  } as never;
}

describe('resolveContractCoverageState', () => {
  it('ACTIVE ก่อนวันเริ่ม → NOT_STARTED (ห้ามตีเป็นหมดอายุ)', () => {
    expect(resolveContractCoverageState(contract(), '2026-09-17')).toBe(
      MaContractCoverageState.NOT_STARTED,
    );
    expect(isContractCurrentlyActive(contract(), '2026-09-17')).toBe(false);
  });

  it('ACTIVE อยู่ในช่วง → IN_FORCE', () => {
    expect(resolveContractCoverageState(contract(), '2026-10-15')).toBe(
      MaContractCoverageState.IN_FORCE,
    );
    expect(isContractCurrentlyActive(contract(), '2026-10-15')).toBe(true);
  });

  it('ACTIVE เลยวันสิ้นสุด → ENDED', () => {
    expect(resolveContractCoverageState(contract(), '2027-10-02')).toBe(
      MaContractCoverageState.ENDED,
    );
    expect(isContractCurrentlyActive(contract(), '2027-10-02')).toBe(false);
  });

  it('EXPIRED (ระบบตั้งเมื่อเลยวันสิ้นสุด) → ENDED', () => {
    expect(
      resolveContractCoverageState(contract({ status: MaContractStatus.EXPIRED }), '2027-10-02'),
    ).toBe(MaContractCoverageState.ENDED);
  });

  it('DRAFT / CANCELLED → INACTIVE', () => {
    expect(
      resolveContractCoverageState(contract({ status: MaContractStatus.DRAFT }), '2026-10-15'),
    ).toBe(MaContractCoverageState.INACTIVE);
    expect(
      resolveContractCoverageState(contract({ status: MaContractStatus.CANCELLED }), '2026-10-15'),
    ).toBe(MaContractCoverageState.INACTIVE);
  });
});

describe('toMaContractResponse', () => {
  it('คืน coverageState คู่กับ isCurrentlyActive', () => {
    const response = toMaContractResponse(contract());

    expect(response.coverageState).toBeDefined();
    expect(response.isCurrentlyActive).toBe(
      response.coverageState === MaContractCoverageState.IN_FORCE,
    );
    expect(typeof response.daysUntilExpiry).toBe('number');
  });
});
