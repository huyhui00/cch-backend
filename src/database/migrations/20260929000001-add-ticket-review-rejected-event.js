/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/**
 * C-1 — แอดมินตรวจไม่ผ่าน ตีกลับให้ผู้แก้ (inbox ในแอป ไม่ยิง LINE)
 */
const EVENT_TYPES_BEFORE = [
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
  'TICKET_ASSIGNED',
];

const EVENT_TYPES = [...EVENT_TYPES_BEFORE, 'TICKET_REVIEW_REJECTED'];

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
    await queryInterface.sequelize.query(
      `DELETE FROM notifications WHERE event_type = 'TICKET_REVIEW_REJECTED'`,
    );
    await queryInterface.sequelize.query(
      `DELETE FROM notification_rules WHERE event_type = 'TICKET_REVIEW_REJECTED'`,
    );
    await alterEventType(queryInterface, Sequelize, 'notifications', EVENT_TYPES_BEFORE);
    await alterEventType(queryInterface, Sequelize, 'notification_rules', EVENT_TYPES_BEFORE);
  },
};
