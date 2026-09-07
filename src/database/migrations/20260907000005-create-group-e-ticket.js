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
 * กลุ่ม E — Ticket
 *   tickets, ticket_resolutions, attachments
 *
 * BR-03 — tickets 1:N ticket_resolutions ห้ามรวมเป็นตารางเดียว
 * BR-04 — ปัญหาเดิมกลับมา = เพิ่มรอบในใบเดิม status วนกลับได้
 *
 * ปลายไฟล์นี้ผูก foreign key ของ ma_usages ที่ค้างไว้จากกลุ่ม D
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // ---- tickets ----------------------------------------------------------
    await queryInterface.createTable(
      'tickets',
      {
        id: idColumn(Sequelize),
        ticket_no: { type: Sequelize.STRING(50), allowNull: true },
        customer_id: fk(Sequelize, 'customers', { allowNull: false }),
        project_id: fk(Sequelize, 'projects', { allowNull: true }),
        warranty_id: fk(Sequelize, 'warranties', { allowNull: true }),
        ma_contract_id: fk(Sequelize, 'ma_contracts', { allowNull: true }),
        title: { type: Sequelize.STRING(255), allowNull: false },
        description: { type: Sequelize.TEXT, allowNull: true },
        status: {
          type: Sequelize.ENUM('RECEIVED', 'IN_PROGRESS', 'RESOLVED', 'REOPENED', 'CLOSED'),
          allowNull: false,
          defaultValue: 'RECEIVED',
        },
        priority: {
          type: Sequelize.ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT'),
          allowNull: false,
          defaultValue: 'NORMAL',
        },
        // BR-08 บั๊กเล็กทำฟรีได้แต่ต้องบันทึก จึงต้องเลือก FREE ไม่ใช่เว้นว่าง
        billing_type: {
          type: Sequelize.ENUM('WARRANTY', 'MA_QUOTA', 'ADDON', 'ONE_TIME', 'FREE'),
          allowNull: false,
        },
        reported_channel: {
          type: Sequelize.ENUM('LINE', 'PHONE', 'EMAIL', 'FACEBOOK', 'OTHER'),
          allowNull: false,
        },
        reported_at: { type: Sequelize.DATE, allowNull: false },
        reported_by_contact_id: fk(Sequelize, 'contacts', { allowNull: true }),
        assigned_user_id: fk(Sequelize, 'users', { allowNull: true }),
        resolution_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        first_response_at: { type: Sequelize.DATE, allowNull: true },
        resolved_at: { type: Sequelize.DATE, allowNull: true },
        closed_at: { type: Sequelize.DATE, allowNull: true },
        due_at: { type: Sequelize.DATE, allowNull: true },
        extra_charge: { type: Sequelize.DECIMAL(15, 2), allowNull: true },
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'tickets', [
      { name: 'uq_tickets_ticket_no', fields: ['ticket_no'], unique: true },
      // index หลักของหน้าจอรายการ ticket
      { name: 'idx_tickets_status_priority_reported', fields: ['status', 'priority', 'reported_at'] },
      { name: 'idx_tickets_customer_status', fields: ['customer_id', 'status'] },
      { name: 'idx_tickets_assigned_status', fields: ['assigned_user_id', 'status'] },
      { name: 'idx_tickets_project_id', fields: ['project_id'] },
      // ใช้กับ notification rule แบบ TICKET_SLA
      { name: 'idx_tickets_due_at', fields: ['due_at'] },
      { name: 'idx_tickets_ma_contract_id', fields: ['ma_contract_id'] },
    ]);

    // ---- ticket_resolutions (BR-03) ---------------------------------------
    await queryInterface.createTable(
      'ticket_resolutions',
      {
        id: idColumn(Sequelize),
        ticket_id: fk(Sequelize, 'tickets', { allowNull: false }),
        round: { type: Sequelize.INTEGER, allowNull: false },
        result: {
          type: Sequelize.ENUM('SUCCESS', 'PARTIAL', 'FAILED'),
          allowNull: false,
        },
        detail: { type: Sequelize.TEXT, allowNull: false },
        root_cause: { type: Sequelize.TEXT, allowNull: true },
        resolved_by_user_id: fk(Sequelize, 'users', { allowNull: true }),
        started_at: { type: Sequelize.DATE, allowNull: true },
        resolved_at: { type: Sequelize.DATE, allowNull: false },
        hours_spent: { type: Sequelize.DECIMAL(6, 2), allowNull: true },
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'ticket_resolutions', [
      // UNIQUE ไม่ใช่แค่ index — กันสองคนกดบันทึกพร้อมกันแล้วได้ round ชนกัน
      { name: 'uq_ticket_resolutions_ticket_round', fields: ['ticket_id', 'round'], unique: true },
      { name: 'idx_ticket_resolutions_resolved_by', fields: ['resolved_by_user_id'] },
    ]);

    // ---- attachments (polymorphic) ----------------------------------------
    await queryInterface.createTable(
      'attachments',
      {
        id: idColumn(Sequelize),
        // ไม่มี FK บน ref_id โดยเจตนา เพราะปลายทางเป็นได้หลายตาราง
        ref_type: { type: Sequelize.STRING(50), allowNull: false },
        ref_id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false },
        file_url: { type: Sequelize.STRING(500), allowNull: false },
        file_name: { type: Sequelize.STRING(255), allowNull: false },
        file_size: { type: Sequelize.BIGINT.UNSIGNED, allowNull: true },
        mime_type: { type: Sequelize.STRING(100), allowNull: true },
        uploaded_by_user_id: fk(Sequelize, 'users', { allowNull: true }),
        note: { type: Sequelize.TEXT, allowNull: true },
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'attachments', [
      { name: 'idx_attachments_ref', fields: ['ref_type', 'ref_id'] },
      { name: 'idx_attachments_uploaded_by', fields: ['uploaded_by_user_id'] },
    ]);

    // ---- ผูก FK ที่ค้างไว้จากกลุ่ม D --------------------------------------
    await queryInterface.addConstraint('ma_usages', {
      fields: ['ticket_id'],
      type: 'foreign key',
      name: 'fk_ma_usages_ticket_id',
      references: { table: 'tickets', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    });

    await queryInterface.addConstraint('ma_usages', {
      fields: ['resolution_id'],
      type: 'foreign key',
      name: 'fk_ma_usages_resolution_id',
      references: { table: 'ticket_resolutions', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  },

  async down(queryInterface) {
    // ต้องถอด constraint ของ ma_usages ก่อน ไม่งั้นลบ tickets ไม่ได้
    await queryInterface.removeConstraint('ma_usages', 'fk_ma_usages_resolution_id');
    await queryInterface.removeConstraint('ma_usages', 'fk_ma_usages_ticket_id');

    await dropTables(queryInterface, ['attachments', 'ticket_resolutions', 'tickets']);
  },
};
