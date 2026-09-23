/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/**
 * C-1 คิวดึงซัพพอร์ต → แอดมิน
 *
 * - WAITING_ADMIN   ซัพพอร์ตส่งเข้าคิวกลางแล้ว รอแอดมินกดรับเรื่อง / จัดแจง
 * - WAITING_SUPPORT แอดมินตรวจผ่านแล้ว รอซัพพอร์ตบอกลูกค้า
 * - claimed_by_admin_user_id = แอดมินผู้รับคิว (คนละคนกับ received_by / assigned)
 */
const STATUS_WITH_QUEUE = [
  'RECEIVED',
  'WAITING_ADMIN',
  'ASSIGNED',
  'IN_PROGRESS',
  'RESOLVED',
  'WAITING_SUPPORT',
  'REOPENED',
  'CLOSED',
];

const STATUS_BEFORE = [
  'RECEIVED',
  'ASSIGNED',
  'IN_PROGRESS',
  'RESOLVED',
  'REOPENED',
  'CLOSED',
];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('tickets', 'claimed_by_admin_user_id', {
      type: Sequelize.BIGINT.UNSIGNED,
      allowNull: true,
      after: 'received_by_user_id',
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    await queryInterface.addIndex('tickets', {
      name: 'idx_tickets_claimed_by_admin',
      fields: ['claimed_by_admin_user_id'],
    });

    await queryInterface.addIndex('tickets', {
      name: 'idx_tickets_status_claimed_admin',
      fields: ['status', 'claimed_by_admin_user_id'],
    });

    await queryInterface.changeColumn('tickets', 'status', {
      type: Sequelize.ENUM(...STATUS_WITH_QUEUE),
      allowNull: false,
      defaultValue: 'RECEIVED',
    });
  },

  async down(queryInterface, Sequelize) {
    // ย้ายแถวที่สถานะใหม่กลับไปสถานะเดิมก่อนย่อ ENUM
    await queryInterface.sequelize.query(
      "UPDATE tickets SET status = 'RECEIVED' WHERE status = 'WAITING_ADMIN'",
    );
    await queryInterface.sequelize.query(
      "UPDATE tickets SET status = 'RESOLVED' WHERE status = 'WAITING_SUPPORT'",
    );

    await queryInterface.changeColumn('tickets', 'status', {
      type: Sequelize.ENUM(...STATUS_BEFORE),
      allowNull: false,
      defaultValue: 'RECEIVED',
    });

    await queryInterface.removeIndex('tickets', 'idx_tickets_status_claimed_admin');
    await queryInterface.removeIndex('tickets', 'idx_tickets_claimed_by_admin');
    await queryInterface.removeColumn('tickets', 'claimed_by_admin_user_id');
  },
};
