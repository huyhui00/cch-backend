import { QueryTypes, type Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

/**
 * รหัสที่ระบบออกให้ — รูปแบบสั้น `TK69-0006`
 *   คำนำหน้า + ปี พ.ศ. สองหลัก + เลขรัน 4 หลัก
 * ปีใช้ พ.ศ. เพราะเป็นรหัสที่พนักงานไทยอ่านบนหน้าจอ ไม่ใช่รหัสในฐานข้อมูล
 */
export const CODE_PREFIX = {
  CUSTOMER: 'CUS',
  PROJECT: 'PRJ',
  TICKET: 'TK',
  DELIVERY: 'DLV',
  WARRANTY: 'WAR',
  MA_CONTRACT: 'MA',
} as const;

export type GeneratedCodeKind = keyof typeof CODE_PREFIX;

/** Allocates the next number for a scope while holding the scope row lock. */
export async function nextSequenceNumber(
  sequelize: Sequelize,
  sequenceKey: string,
  transaction: Transaction,
): Promise<number> {
  await sequelize.query(
    `INSERT IGNORE INTO code_sequences (sequence_key, next_value)
     VALUES (:sequenceKey, 1)`,
    { replacements: { sequenceKey }, transaction },
  );

  const rows = await sequelize.query<{ nextValue: number }>(
    `SELECT next_value AS nextValue
     FROM code_sequences
     WHERE sequence_key = :sequenceKey
     FOR UPDATE`,
    { replacements: { sequenceKey }, type: QueryTypes.SELECT, transaction },
  );

  if (rows.length === 0) {
    throw new Error(`ไม่พบตัวนับรหัส ${sequenceKey}`);
  }

  const nextValue = Number(rows[0].nextValue);

  await sequelize.query(
    `UPDATE code_sequences
     SET next_value = :nextValue
     WHERE sequence_key = :sequenceKey`,
    { replacements: { sequenceKey, nextValue: nextValue + 1 }, transaction },
  );

  return nextValue;
}

export function buddhistYearShort(date: Date = new Date()): string {
  return String((date.getFullYear() + 543) % 100).padStart(2, '0');
}

export function formatGeneratedCode(
  prefix: string,
  sequence: number,
  date: Date = new Date(),
): string {
  return `${prefix}${buddhistYearShort(date)}-${String(sequence).padStart(4, '0')}`;
}

export async function nextGeneratedCode(
  sequelize: Sequelize,
  kind: GeneratedCodeKind,
  transaction: Transaction,
  date: Date = new Date(),
): Promise<string> {
  const sequence = await nextSequenceNumber(
    sequelize,
    `${kind}:${date.getFullYear()}`,
    transaction,
  );
  return formatGeneratedCode(CODE_PREFIX[kind], sequence, date);
}
