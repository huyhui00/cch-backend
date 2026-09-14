import { QueryTypes, type Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

/**
 * Allocates the next number for a scope while holding the scope row lock.
 * The caller must use the same transaction for allocation and record creation.
 */
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
