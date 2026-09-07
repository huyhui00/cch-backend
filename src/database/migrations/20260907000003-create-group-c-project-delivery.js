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
 * กลุ่ม C — Project & Delivery
 *   projects, tasks, deliveries, warranties, documents
 *
 * tasks มี self-reference (parent_task_id)
 * warranties ผูกกับ delivery_id เป็นหลักตาม BR-06
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // ---- projects ---------------------------------------------------------
    await queryInterface.createTable(
      'projects',
      {
        id: idColumn(Sequelize),
        customer_id: fk(Sequelize, 'customers', { allowNull: false }),
        code: { type: Sequelize.STRING(50), allowNull: true },
        name: { type: Sequelize.STRING(255), allowNull: false },
        description: { type: Sequelize.TEXT, allowNull: true },
        project_type: { type: Sequelize.STRING(100), allowNull: true },
        status: {
          type: Sequelize.ENUM('DRAFT', 'IN_PROGRESS', 'DELIVERED', 'CLOSED', 'CANCELLED'),
          allowNull: false,
          defaultValue: 'DRAFT',
        },
        priority: {
          type: Sequelize.ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT'),
          allowNull: false,
          defaultValue: 'NORMAL',
        },
        start_date: { type: Sequelize.DATEONLY, allowNull: true },
        target_end_date: { type: Sequelize.DATEONLY, allowNull: true },
        actual_end_date: { type: Sequelize.DATEONLY, allowNull: true },
        contract_value: { type: Sequelize.DECIMAL(15, 2), allowNull: true },
        manager_user_id: fk(Sequelize, 'users', { allowNull: true }),
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'projects', [
      { name: 'uq_projects_code', fields: ['code'], unique: true },
      { name: 'idx_projects_status_priority', fields: ['status', 'priority'] },
      { name: 'idx_projects_customer_id', fields: ['customer_id'] },
      { name: 'idx_projects_target_end_date', fields: ['target_end_date'] },
    ]);

    // ---- tasks (self-reference) -------------------------------------------
    await queryInterface.createTable(
      'tasks',
      {
        id: idColumn(Sequelize),
        project_id: fk(Sequelize, 'projects', { allowNull: false }),
        // ลบ task แม่ = ลูกกลายเป็น task ระดับบนสุด ไม่ใช่หายตามไปด้วย
        parent_task_id: fk(Sequelize, 'tasks', { allowNull: true, onDelete: 'SET NULL' }),
        title: { type: Sequelize.STRING(255), allowNull: false },
        description: { type: Sequelize.TEXT, allowNull: true },
        status: {
          type: Sequelize.ENUM('TODO', 'DOING', 'WAITING', 'REVIEW', 'DONE'),
          allowNull: false,
          defaultValue: 'TODO',
        },
        assigned_user_id: fk(Sequelize, 'users', { allowNull: true }),
        start_date: { type: Sequelize.DATEONLY, allowNull: true },
        due_date: { type: Sequelize.DATEONLY, allowNull: true },
        completed_at: { type: Sequelize.DATE, allowNull: true },
        estimated_hours: { type: Sequelize.DECIMAL(6, 2), allowNull: true },
        actual_hours: { type: Sequelize.DECIMAL(6, 2), allowNull: true },
        sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'tasks', [
      { name: 'idx_tasks_project_status', fields: ['project_id', 'status'] },
      { name: 'idx_tasks_assigned_status', fields: ['assigned_user_id', 'status'] },
      // ใช้กับ notification rule แบบ TASK_OVERDUE
      { name: 'idx_tasks_status_due_date', fields: ['status', 'due_date'] },
      { name: 'idx_tasks_parent_task_id', fields: ['parent_task_id'] },
    ]);

    // ---- deliveries -------------------------------------------------------
    await queryInterface.createTable(
      'deliveries',
      {
        id: idColumn(Sequelize),
        project_id: fk(Sequelize, 'projects', { allowNull: false }),
        delivery_no: { type: Sequelize.STRING(50), allowNull: true },
        title: { type: Sequelize.STRING(255), allowNull: false },
        description: { type: Sequelize.TEXT, allowNull: true },
        // BR-06 จุดตั้งต้นของระยะประกัน
        delivered_at: { type: Sequelize.DATE, allowNull: false },
        acceptance_status: {
          type: Sequelize.ENUM('PENDING', 'ACCEPTED', 'REJECTED'),
          allowNull: false,
          defaultValue: 'PENDING',
        },
        accepted_at: { type: Sequelize.DATE, allowNull: true },
        accepted_by_contact_id: fk(Sequelize, 'contacts', { allowNull: true }),
        note: { type: Sequelize.TEXT, allowNull: true },
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'deliveries', [
      { name: 'uq_deliveries_delivery_no', fields: ['delivery_no'], unique: true },
      { name: 'idx_deliveries_project_id', fields: ['project_id'] },
      { name: 'idx_deliveries_acceptance_status', fields: ['acceptance_status'] },
      // ใช้กับ notification rule แบบ DELIVERY_DUE
      { name: 'idx_deliveries_delivered_at', fields: ['delivered_at'] },
    ]);

    // ---- warranties (BR-06) -----------------------------------------------
    await queryInterface.createTable(
      'warranties',
      {
        id: idColumn(Sequelize),
        delivery_id: fk(Sequelize, 'deliveries', { allowNull: false }),
        project_id: fk(Sequelize, 'projects', { allowNull: false }),
        duration_month: { type: Sequelize.INTEGER, allowNull: false },
        start_date: { type: Sequelize.DATEONLY, allowNull: false },
        end_date: { type: Sequelize.DATEONLY, allowNull: false },
        status: {
          type: Sequelize.ENUM('ACTIVE', 'EXPIRED', 'VOID'),
          allowNull: false,
          defaultValue: 'ACTIVE',
        },
        scope_note: { type: Sequelize.TEXT, allowNull: true },
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'warranties', [
      // ใช้กับ notification rule แบบ WARRANTY_EXPIRING
      { name: 'idx_warranties_status_end_date', fields: ['status', 'end_date'] },
      { name: 'idx_warranties_delivery_id', fields: ['delivery_id'] },
      { name: 'idx_warranties_project_id', fields: ['project_id'] },
    ]);

    // ---- documents (BR-12) ------------------------------------------------
    await queryInterface.createTable(
      'documents',
      {
        id: idColumn(Sequelize),
        customer_id: fk(Sequelize, 'customers', { allowNull: true }),
        project_id: fk(Sequelize, 'projects', { allowNull: true }),
        doc_type: {
          type: Sequelize.ENUM(
            'QUOTATION',
            'PO',
            'CONTRACT',
            'DELIVERY_NOTE',
            'MA_CONTRACT',
            'OTHER',
          ),
          allowNull: false,
        },
        doc_no: { type: Sequelize.STRING(100), allowNull: true },
        title: { type: Sequelize.STRING(255), allowNull: false },
        issued_date: { type: Sequelize.DATEONLY, allowNull: true },
        file_url: { type: Sequelize.STRING(500), allowNull: true },
        file_name: { type: Sequelize.STRING(255), allowNull: true },
        file_size: { type: Sequelize.BIGINT.UNSIGNED, allowNull: true },
        mime_type: { type: Sequelize.STRING(100), allowNull: true },
        note: { type: Sequelize.TEXT, allowNull: true },
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'documents', [
      { name: 'idx_documents_doc_type', fields: ['doc_type'] },
      { name: 'idx_documents_customer_id', fields: ['customer_id'] },
      { name: 'idx_documents_project_id', fields: ['project_id'] },
    ]);
  },

  async down(queryInterface) {
    await dropTables(queryInterface, [
      'documents',
      'warranties',
      'deliveries',
      'tasks',
      'projects',
    ]);
  },
};
