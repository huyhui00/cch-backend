/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const {
  TABLE_OPTIONS,
  idColumn,
  auditColumns,
  fk,
  addIndexes,
  dropTables,
} = require('../migration-helpers');

/**
 * กลุ่ม B — Customer & CRM
 *   customers, contacts, communication_logs, follow_ups
 *
 * อ้างถึงกลุ่ม A (users) เท่านั้น ไม่อ้างกลุ่ม C-F เพื่อให้ลำดับ FK ไม่พัง
 * ถ้าภายหลังต้องผูก follow_ups เข้ากับ project หรือ ticket
 * ให้เพิ่มเป็น migration ใหม่หลังกลุ่ม E ไม่ใช่แก้ไฟล์นี้
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // ---- customers (BR-01 ไม่มี login ใด ๆ) -------------------------------
    await queryInterface.createTable(
      'customers',
      {
        id: idColumn(Sequelize),
        code: { type: Sequelize.STRING(50), allowNull: true },
        name: { type: Sequelize.STRING(255), allowNull: false },
        tax_id: { type: Sequelize.STRING(20), allowNull: true },
        business_type: { type: Sequelize.STRING(150), allowNull: true },
        address: { type: Sequelize.TEXT, allowNull: true },
        province: { type: Sequelize.STRING(100), allowNull: true },
        postal_code: { type: Sequelize.STRING(10), allowNull: true },
        phone: { type: Sequelize.STRING(30), allowNull: true },
        email: { type: Sequelize.STRING(255), allowNull: true },
        website: { type: Sequelize.STRING(255), allowNull: true },
        line_official_id: { type: Sequelize.STRING(100), allowNull: true },
        facebook_url: { type: Sequelize.STRING(255), allowNull: true },
        status: {
          type: Sequelize.ENUM('PROSPECT', 'ACTIVE', 'INACTIVE', 'CHURNED'),
          allowNull: false,
          defaultValue: 'PROSPECT',
        },
        source: { type: Sequelize.STRING(100), allowNull: true },
        owner_user_id: fk(Sequelize, 'users', { allowNull: true }),
        last_contacted_at: { type: Sequelize.DATE, allowNull: true },
        note: { type: Sequelize.TEXT, allowNull: true },
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'customers', [
      { name: 'uq_customers_code', fields: ['code'], unique: true },
      { name: 'idx_customers_status', fields: ['status'] },
      { name: 'idx_customers_name', fields: ['name'] },
      // ใช้กับ notification rule แบบ CUSTOMER_IDLE
      { name: 'idx_customers_last_contacted_at', fields: ['last_contacted_at'] },
    ]);

    // ---- contacts ---------------------------------------------------------
    await queryInterface.createTable(
      'contacts',
      {
        id: idColumn(Sequelize),
        customer_id: fk(Sequelize, 'customers', { allowNull: false }),
        name: { type: Sequelize.STRING(255), allowNull: false },
        nickname: { type: Sequelize.STRING(100), allowNull: true },
        position: { type: Sequelize.STRING(150), allowNull: true },
        phone: { type: Sequelize.STRING(30), allowNull: true },
        email: { type: Sequelize.STRING(255), allowNull: true },
        line_id: { type: Sequelize.STRING(100), allowNull: true },
        is_primary: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        note: { type: Sequelize.TEXT, allowNull: true },
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'contacts', [
      { name: 'idx_contacts_customer_primary', fields: ['customer_id', 'is_primary'] },
    ]);

    // ---- communication_logs (BR-02) ---------------------------------------
    await queryInterface.createTable(
      'communication_logs',
      {
        id: idColumn(Sequelize),
        customer_id: fk(Sequelize, 'customers', { allowNull: false }),
        contact_id: fk(Sequelize, 'contacts', { allowNull: true }),
        channel: {
          type: Sequelize.ENUM('LINE', 'PHONE', 'EMAIL', 'FACEBOOK', 'MEETING', 'OTHER'),
          allowNull: false,
        },
        occurred_at: { type: Sequelize.DATE, allowNull: false },
        subject: { type: Sequelize.STRING(255), allowNull: true },
        content: { type: Sequelize.TEXT, allowNull: true },
        handled_by_user_id: fk(Sequelize, 'users', { allowNull: true }),
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'communication_logs', [
      { name: 'idx_comm_logs_customer_occurred', fields: ['customer_id', 'occurred_at'] },
      { name: 'idx_comm_logs_channel', fields: ['channel'] },
    ]);

    // ---- follow_ups -------------------------------------------------------
    await queryInterface.createTable(
      'follow_ups',
      {
        id: idColumn(Sequelize),
        customer_id: fk(Sequelize, 'customers', { allowNull: false }),
        title: { type: Sequelize.STRING(255), allowNull: false },
        detail: { type: Sequelize.TEXT, allowNull: true },
        due_date: { type: Sequelize.DATEONLY, allowNull: false },
        status: {
          type: Sequelize.ENUM('PLANNED', 'DONE', 'OVERDUE', 'CANCELLED'),
          allowNull: false,
          defaultValue: 'PLANNED',
        },
        assigned_user_id: fk(Sequelize, 'users', { allowNull: true }),
        completed_at: { type: Sequelize.DATE, allowNull: true },
        result_note: { type: Sequelize.TEXT, allowNull: true },
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'follow_ups', [
      // ใช้กับ notification rule แบบ FOLLOWUP_DUE
      { name: 'idx_follow_ups_status_due_date', fields: ['status', 'due_date'] },
      { name: 'idx_follow_ups_assigned_status', fields: ['assigned_user_id', 'status'] },
      { name: 'idx_follow_ups_customer_id', fields: ['customer_id'] },
    ]);
  },

  async down(queryInterface) {
    await dropTables(queryInterface, [
      'follow_ups',
      'communication_logs',
      'contacts',
      'customers',
    ]);
  },
};
