/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * ตัวช่วยของ migration — วางไว้นอกโฟลเดอร์ migrations/ โดยตั้งใจ
 * เพราะ sequelize-cli จะพยายามรันทุกไฟล์ที่อยู่ในโฟลเดอร์นั้นเป็น migration
 */

/** ตัวเลือกของทุกตาราง — utf8mb4 เพื่อรองรับภาษาไทยและ emoji */
const TABLE_OPTIONS = {
  charset: 'utf8mb4',
  collate: 'utf8mb4_unicode_ci',
};

/** primary key มาตรฐาน */
function idColumn(Sequelize) {
  return {
    type: Sequelize.BIGINT.UNSIGNED,
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
  };
}

/**
 * ฟิลด์มาตรฐานของทุกตารางหลัก (CLAUDE.md 6.3)
 * ต้องเป็นชุดสุดท้ายของ createTable เสมอ เพื่อให้ลำดับคอลัมน์ในทุกตารางเหมือนกัน
 */
function auditColumns(Sequelize) {
  return {
    created_at: {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
    },
    created_by: { type: Sequelize.BIGINT.UNSIGNED, allowNull: true },
    updated_at: {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
    },
    updated_by: { type: Sequelize.BIGINT.UNSIGNED, allowNull: true },
    deleted_at: { type: Sequelize.DATE, allowNull: true },
    deleted_by: { type: Sequelize.BIGINT.UNSIGNED, allowNull: true },
  };
}

/** ฟิลด์เวลาของตาราง junction / append-only ที่ไม่เปิด paranoid */
function createdOnlyColumns(Sequelize) {
  return {
    created_at: {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
    },
    created_by: { type: Sequelize.BIGINT.UNSIGNED, allowNull: true },
  };
}

/**
 * คอลัมน์ foreign key
 *
 * onDelete เป็น RESTRICT เป็นค่าเริ่มต้นโดยตั้งใจ — ข้อมูลในระบบนี้เป็น soft delete
 * ทั้งหมด (BR-09) การลบจริงจึงไม่ควรเกิด ถ้าเกิดขึ้นก็ควรถูกกันไว้ ไม่ใช่ลบต่อเป็นทอด ๆ
 */
function fk(Sequelize, table, options) {
  const opts = options || {};
  return {
    type: Sequelize.BIGINT.UNSIGNED,
    allowNull: opts.allowNull === undefined ? true : opts.allowNull,
    references: { model: table, key: 'id' },
    onUpdate: 'CASCADE',
    onDelete: opts.onDelete || 'RESTRICT',
  };
}

/** คอลัมน์ที่เป็น FK ในเชิงตรรกะ แต่ยังไม่ผูก constraint (ใช้ตอนข้ามกลุ่ม migration) */
function fkColumnWithoutConstraint(Sequelize, allowNull) {
  return { type: Sequelize.BIGINT.UNSIGNED, allowNull: allowNull === undefined ? true : allowNull };
}

/** สร้าง index หลายตัวรวดเดียว */
async function addIndexes(queryInterface, table, indexes) {
  for (const index of indexes) {
    await queryInterface.addIndex(table, index.fields, {
      name: index.name,
      unique: !!index.unique,
    });
  }
}

/** ลบตารางตามลำดับที่ให้มา (ต้องเป็นลำดับย้อนกลับของตอนสร้าง) */
async function dropTables(queryInterface, tables) {
  for (const table of tables) {
    await queryInterface.dropTable(table);
  }
}

module.exports = {
  TABLE_OPTIONS,
  idColumn,
  auditColumns,
  createdOnlyColumns,
  fk,
  fkColumnWithoutConstraint,
  addIndexes,
  dropTables,
};
