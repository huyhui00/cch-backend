import { MaContractStatus } from '../../models';

/**
 * สถานะที่ "เคยหรือกำลังคุ้มครอง" — ใช้คู่กับช่วงวันเสมอ
 * EXPIRED คือ ACTIVE ที่เลยวันสิ้นสุดแล้ว การหาสัญญาที่คุ้มครอง ณ วันในอดีตจึงต้องนับด้วย
 */
export const COVERING_CONTRACT_STATUSES = [MaContractStatus.ACTIVE, MaContractStatus.EXPIRED];

/**
 * EXPIRED เป็นค่าที่ระบบตัดสินจากวันสิ้นสุด ไม่ใช่ค่าที่คนตั้ง
 * ACTIVE ที่เลยวันสิ้นสุด → EXPIRED · EXPIRED ที่ถูกขยายวันสิ้นสุด → ACTIVE
 */
export function deriveContractStatus(
  status: MaContractStatus,
  endDate: string,
  today: string,
): MaContractStatus {
  if (status === MaContractStatus.ACTIVE && endDate < today) {
    return MaContractStatus.EXPIRED;
  }
  if (status === MaContractStatus.EXPIRED && endDate >= today) {
    return MaContractStatus.ACTIVE;
  }
  return status;
}
