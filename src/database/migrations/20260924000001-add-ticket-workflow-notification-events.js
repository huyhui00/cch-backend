/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/**
 * C-3 — event แจ้งเตือนในแอปตอนส่งงานข้ามฝ่ายในสายใบปัญหา
 * ใช้เฉพาะ inbox ในระบบ (ไม่บังคับ LINE — LINE ยังเน้นวันหมดอายุ/กำหนดตามเดิม)
 *
 * MySQL ต้อง ALTER ENUM ทั้ง notification_rules และ notifications ให้ตรงกัน
 */
const EVENT_TYPES = [
  'MA_EXPIRING',
  'WARRANTY_EXPIRING',
  'TASK_OVERDUE',
  'DELIVERY_DUE',
  'FOLLOWUP_DUE',
  'TICKET_SLA',
  'CUSTOMER_IDLE',
  'TICKET_SENT_TO_ADMIN',
  'TICKET_AWAITING_REVIEW',
  'TICKET_RETURNED_TO_SUPPORT',
];

const EVENT_TYPES_BEFORE = [
  'MA_EXPIRING',
  'WARRANTY_EXPIRING',
  'TASK_OVERDUE',
  'DELIVERY_DUE',
  'FOLLOWUP_DUE',
  'TICKET_SLA',
  'CUSTOMER_IDLE',
];

async function alterEventType(queryInterface, Sequelize, table, values) {
  await queryInterface.changeColumn(table, 'event_type', {
    type: Sequelize.ENUM(...values),
    allowNull: false,
  });
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await alterEventType(queryInterface, Sequelize, 'notification_rules', EVENT_TYPES);
    await alterEventType(queryInterface, Sequelize, 'notifications', EVENT_TYPES);
  },

  async down(queryInterface, Sequelize) {
    // ลบแถวที่ใช้ค่าใหม่ออกก่อน ไม่งั้น ALTER กลับ ENUM เดิมจะพัง
    await queryInterface.sequelize.query(
      `DELETE FROM notifications WHERE event_type IN (
        'TICKET_SENT_TO_ADMIN', 'TICKET_AWAITING_REVIEW', 'TICKET_RETURNED_TO_SUPPORT'
      )`,
    );
    await queryInterface.sequelize.query(
      `DELETE FROM notification_rules WHERE event_type IN (
        'TICKET_SENT_TO_ADMIN', 'TICKET_AWAITING_REVIEW', 'TICKET_RETURNED_TO_SUPPORT'
      )`,
    );
    await alterEventType(queryInterface, Sequelize, 'notifications', EVENT_TYPES_BEFORE);
    await alterEventType(queryInterface, Sequelize, 'notification_rules', EVENT_TYPES_BEFORE);
  },
};
