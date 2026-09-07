/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const {
  TABLE_OPTIONS,
  idColumn,
  auditColumns,
  fk,
  fkColumnWithoutConstraint,
  addIndexes,
  dropTables,
} = require('../migration-helpers');

/**
 * กลุ่ม D — MA
 *   ma_plans, ma_plan_items, ma_contracts, ma_addons, ma_usages
 *
 * BR-05 — เนื้อหาแผนอยู่ ma_plans / ราคาอยู่ ma_contracts.price
 * ma_contracts มี self-reference (previous_contract_id) สำหรับสายการต่อสัญญา
 *
 * ข้อควรรู้: ma_usages.ticket_id และ resolution_id ชี้ไปที่ตารางของกลุ่ม E
 * ซึ่งยังไม่ถูกสร้างตอนนี้ จึงสร้างเป็นคอลัมน์เปล่าไว้ก่อน
 * แล้วไปผูก foreign key จริงในไฟล์ของกลุ่ม E
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // ---- ma_plans (ห้ามมีคอลัมน์ราคา — BR-05) -----------------------------
    await queryInterface.createTable(
      'ma_plans',
      {
        id: idColumn(Sequelize),
        code: { type: Sequelize.STRING(50), allowNull: false },
        name: { type: Sequelize.STRING(150), allowNull: false },
        description: { type: Sequelize.TEXT, allowNull: true },
        bug_quota_per_month: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        response_time_hour: { type: Sequelize.INTEGER, allowNull: true },
        onsite_quota_per_month: { type: Sequelize.INTEGER, allowNull: true },
        is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'ma_plans', [
      { name: 'uq_ma_plans_code', fields: ['code'], unique: true },
      { name: 'idx_ma_plans_is_active', fields: ['is_active'] },
    ]);

    // ---- ma_plan_items ----------------------------------------------------
    await queryInterface.createTable(
      'ma_plan_items',
      {
        id: idColumn(Sequelize),
        plan_id: fk(Sequelize, 'ma_plans', { allowNull: false }),
        title: { type: Sequelize.STRING(255), allowNull: false },
        detail: { type: Sequelize.TEXT, allowNull: true },
        sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'ma_plan_items', [
      { name: 'idx_ma_plan_items_plan_id', fields: ['plan_id'] },
    ]);

    // ---- ma_contracts (ราคาอยู่ที่นี่ — BR-05) ----------------------------
    await queryInterface.createTable(
      'ma_contracts',
      {
        id: idColumn(Sequelize),
        customer_id: fk(Sequelize, 'customers', { allowNull: false }),
        project_id: fk(Sequelize, 'projects', { allowNull: false }),
        plan_id: fk(Sequelize, 'ma_plans', { allowNull: false }),
        // สายการต่อสัญญา ฉบับเก่าถูกลบไม่ได้อยู่แล้ว (soft delete) จึงใช้ SET NULL กันเหนียว
        previous_contract_id: fk(Sequelize, 'ma_contracts', {
          allowNull: true,
          onDelete: 'SET NULL',
        }),
        contract_no: { type: Sequelize.STRING(100), allowNull: true },
        price: { type: Sequelize.DECIMAL(15, 2), allowNull: false },
        billing_cycle: {
          type: Sequelize.ENUM('MONTHLY', 'YEARLY'),
          allowNull: false,
          defaultValue: 'YEARLY',
        },
        start_date: { type: Sequelize.DATEONLY, allowNull: false },
        end_date: { type: Sequelize.DATEONLY, allowNull: false },
        status: {
          type: Sequelize.ENUM('DRAFT', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'RENEWED'),
          allowNull: false,
          defaultValue: 'DRAFT',
        },
        signed_date: { type: Sequelize.DATEONLY, allowNull: true },
        signed_file_url: { type: Sequelize.STRING(500), allowNull: true },
        note: { type: Sequelize.TEXT, allowNull: true },
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'ma_contracts', [
      { name: 'uq_ma_contracts_contract_no', fields: ['contract_no'], unique: true },
      // ใช้กับ notification rule แบบ MA_EXPIRING
      { name: 'idx_ma_contracts_status_end_date', fields: ['status', 'end_date'] },
      { name: 'idx_ma_contracts_customer_id', fields: ['customer_id'] },
      { name: 'idx_ma_contracts_project_status', fields: ['project_id', 'status'] },
      { name: 'idx_ma_contracts_previous_contract_id', fields: ['previous_contract_id'] },
    ]);

    // ---- ma_addons --------------------------------------------------------
    await queryInterface.createTable(
      'ma_addons',
      {
        id: idColumn(Sequelize),
        contract_id: fk(Sequelize, 'ma_contracts', { allowNull: false }),
        addon_type: {
          type: Sequelize.ENUM('EXTRA_QUOTA', 'OTHER'),
          allowNull: false,
          defaultValue: 'EXTRA_QUOTA',
        },
        title: { type: Sequelize.STRING(255), allowNull: false },
        extra_quota: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        price: { type: Sequelize.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },
        effective_year: { type: Sequelize.SMALLINT, allowNull: true },
        effective_month: { type: Sequelize.TINYINT, allowNull: true },
        note: { type: Sequelize.TEXT, allowNull: true },
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'ma_addons', [
      {
        name: 'idx_ma_addons_contract_period',
        fields: ['contract_id', 'effective_year', 'effective_month'],
      },
    ]);

    // ---- ma_usages --------------------------------------------------------
    await queryInterface.createTable(
      'ma_usages',
      {
        id: idColumn(Sequelize),
        contract_id: fk(Sequelize, 'ma_contracts', { allowNull: false }),
        // FK ผูกทีหลังในกลุ่ม E เพราะ tickets ยังไม่มีตอนนี้
        ticket_id: fkColumnWithoutConstraint(Sequelize, false),
        resolution_id: fkColumnWithoutConstraint(Sequelize, true),
        period_year: { type: Sequelize.SMALLINT, allowNull: false },
        period_month: { type: Sequelize.TINYINT, allowNull: false },
        used_at: { type: Sequelize.DATE, allowNull: false },
        is_over_quota: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        extra_charge: { type: Sequelize.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },
        note: { type: Sequelize.TEXT, allowNull: true },
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'ma_usages', [
      // 1 ปัญหา หักโควตาได้ครั้งเดียว ไม่ว่าจะแก้กี่รอบ
      { name: 'uq_ma_usages_ticket_id', fields: ['ticket_id'], unique: true },
      // ใช้ตอนนับโควตาของเดือน (CLAUDE.md 9.2)
      {
        name: 'idx_ma_usages_contract_period',
        fields: ['contract_id', 'period_year', 'period_month'],
      },
      { name: 'idx_ma_usages_resolution_id', fields: ['resolution_id'] },
    ]);
  },

  async down(queryInterface) {
    await dropTables(queryInterface, [
      'ma_usages',
      'ma_addons',
      'ma_contracts',
      'ma_plan_items',
      'ma_plans',
    ]);
  },
};
