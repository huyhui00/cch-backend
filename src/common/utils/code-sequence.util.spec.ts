/// <reference types="jest" />

import { formatGeneratedCode, buddhistYearShort } from './code-sequence.util';

describe('formatGeneratedCode', () => {
  const on = new Date(2026, 8, 21);

  it('ออกเป็นคำนำหน้า + ปี พ.ศ. สองหลัก + เลข 4 หลัก', () => {
    expect(buddhistYearShort(on)).toBe('69');
    expect(formatGeneratedCode('TK', 6, on)).toBe('TK69-0006');
    expect(formatGeneratedCode('CUS', 1, on)).toBe('CUS69-0001');
    expect(formatGeneratedCode('PRJ', 12, on)).toBe('PRJ69-0012');
    expect(formatGeneratedCode('DLV', 3, on)).toBe('DLV69-0003');
    expect(formatGeneratedCode('WAR', 8, on)).toBe('WAR69-0008');
    expect(formatGeneratedCode('MA', 14, on)).toBe('MA69-0014');
  });
});
