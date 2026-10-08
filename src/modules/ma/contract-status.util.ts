import { MaContractStatus } from '../../models';

export const COVERING_CONTRACT_STATUSES = [MaContractStatus.ACTIVE, MaContractStatus.EXPIRED];

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
