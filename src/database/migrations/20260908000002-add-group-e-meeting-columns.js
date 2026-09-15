/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { fk, addIndexes } = require('../migration-helpers');

/**
 * กลุ่ม E — คอลัมน์ที่ตกหล่นจากการประชุม (CLAUDE.md 13 : A-3)
 *
 *   tickets.received_by_user_id   "กำหนดผู้รับผิดชอบแก้ไข โดยแยกจากผู้รับเรื่อง"
 *                                 (ประชุมครั้งที่ 2 นาที 09:33)
 *
 * ของเดิมมี 2 ฟิลด์ที่เกี่ยวกับคน แต่ยังขาดคนที่สาม
 *   reported_by_contact_id  ผู้ติดต่อ "ฝั่งลูกค้า" ที่เป็นคนแจ้งปัญหาเข้ามา
 *   assigned_user_id        พนักงานที่รับผิดชอบ "แก้ไข"
 *   received_by_user_id     พนักงานที่ "รับเรื่อง" ไว้   <-- เพิ่มในไฟล์นี้
 *
 * ตาม BR-02 การสื่อสารเกิดนอกระบบแล้วมาบันทึกย้อนหลัง คนที่รับ LINE จากลูกค้า
 * กับคนที่ลงมือแก้บั๊กจึงมักเป็นคนละคน และต้องตามรอยได้ทั้งคู่ (BR-09)
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn(
      'tickets',
      'received_by_user_id',
      fk(Sequelize, 'users', { allowNull: true }),
    );

    await addIndexes(queryInterface, 'tickets', [
      { name: 'idx_tickets_received_by', fields: ['received_by_user_id'] },
    ]);
  },

  async down(queryInterface) {
    const constraints = await queryInterface.getForeignKeyReferencesForTable('tickets');
    const receivedByConstraint = constraints.find(
      (constraint) => constraint.columnName === 'received_by_user_id',
    );

    if (receivedByConstraint) {
      await queryInterface.removeConstraint('tickets', receivedByConstraint.constraintName);
    }

    await queryInterface.removeIndex('tickets', 'idx_tickets_received_by');
    await queryInterface.removeColumn('tickets', 'received_by_user_id');
  },
};
