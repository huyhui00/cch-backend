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

const EVENT_TYPES = [
  'MA_EXPIRING',
  'WARRANTY_EXPIRING',
  'TASK_OVERDUE',
  'DELIVERY_DUE',
  'FOLLOWUP_DUE',
  'TICKET_SLA',
  'CUSTOMER_IDLE',
];

/**
 * กลุ่ม F — Survey & Notify
 *   surveys, survey_questions, survey_assignments, survey_responses,
 *   survey_answers, notification_rules, notifications
 *
 * BR-11 — notifications.target_user_id ชี้ไป users เท่านั้นและเป็น NOT NULL
 * ไม่มีคอลัมน์ที่ทำให้ยิงหาลูกค้าได้เลย
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // ---- surveys ----------------------------------------------------------
    await queryInterface.createTable(
      'surveys',
      {
        id: idColumn(Sequelize),
        title: { type: Sequelize.STRING(255), allowNull: false },
        description: { type: Sequelize.TEXT, allowNull: true },
        is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        valid_from: { type: Sequelize.DATEONLY, allowNull: true },
        valid_to: { type: Sequelize.DATEONLY, allowNull: true },
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'surveys', [
      { name: 'idx_surveys_is_active', fields: ['is_active'] },
    ]);

    // ---- survey_questions -------------------------------------------------
    await queryInterface.createTable(
      'survey_questions',
      {
        id: idColumn(Sequelize),
        survey_id: fk(Sequelize, 'surveys', { allowNull: false }),
        question_text: { type: Sequelize.TEXT, allowNull: false },
        question_type: {
          type: Sequelize.ENUM('RATING', 'CHOICE', 'MULTI_CHOICE', 'TEXT'),
          allowNull: false,
        },
        is_required: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        options: { type: Sequelize.JSON, allowNull: true },
        min_value: { type: Sequelize.INTEGER, allowNull: true },
        max_value: { type: Sequelize.INTEGER, allowNull: true },
        sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'survey_questions', [
      { name: 'idx_survey_questions_survey_sort', fields: ['survey_id', 'sort_order'] },
    ]);

    // ---- survey_assignments -----------------------------------------------
    // Q1 ยังไม่สรุป จึงเปิดทางไว้ทั้ง access_token (ลิงก์สาธารณะ)
    // และ filled_by_user_id (พนักงานกรอกแทน) — ลูกค้ายังไม่มีบัญชี (BR-01)
    await queryInterface.createTable(
      'survey_assignments',
      {
        id: idColumn(Sequelize),
        survey_id: fk(Sequelize, 'surveys', { allowNull: false }),
        customer_id: fk(Sequelize, 'customers', { allowNull: false }),
        contact_id: fk(Sequelize, 'contacts', { allowNull: true }),
        project_id: fk(Sequelize, 'projects', { allowNull: true }),
        status: {
          type: Sequelize.ENUM('PENDING', 'SENT', 'ANSWERED', 'EXPIRED'),
          allowNull: false,
          defaultValue: 'PENDING',
        },
        access_token: { type: Sequelize.STRING(100), allowNull: true },
        token_expires_at: { type: Sequelize.DATE, allowNull: true },
        filled_by_user_id: fk(Sequelize, 'users', { allowNull: true }),
        sent_at: { type: Sequelize.DATE, allowNull: true },
        answered_at: { type: Sequelize.DATE, allowNull: true },
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'survey_assignments', [
      { name: 'uq_survey_assignments_access_token', fields: ['access_token'], unique: true },
      { name: 'idx_survey_assignments_survey_status', fields: ['survey_id', 'status'] },
      { name: 'idx_survey_assignments_customer_id', fields: ['customer_id'] },
    ]);

    // ---- survey_responses -------------------------------------------------
    await queryInterface.createTable(
      'survey_responses',
      {
        id: idColumn(Sequelize),
        assignment_id: fk(Sequelize, 'survey_assignments', { allowNull: false }),
        survey_id: fk(Sequelize, 'surveys', { allowNull: false }),
        customer_id: fk(Sequelize, 'customers', { allowNull: false }),
        submitted_at: { type: Sequelize.DATE, allowNull: false },
        overall_score: { type: Sequelize.DECIMAL(5, 2), allowNull: true },
        comment: { type: Sequelize.TEXT, allowNull: true },
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'survey_responses', [
      // 1 assignment ตอบได้ครั้งเดียว
      { name: 'uq_survey_responses_assignment_id', fields: ['assignment_id'], unique: true },
      { name: 'idx_survey_responses_survey_submitted', fields: ['survey_id', 'submitted_at'] },
      { name: 'idx_survey_responses_customer_id', fields: ['customer_id'] },
    ]);

    // ---- survey_answers ---------------------------------------------------
    await queryInterface.createTable(
      'survey_answers',
      {
        id: idColumn(Sequelize),
        response_id: fk(Sequelize, 'survey_responses', { allowNull: false }),
        question_id: fk(Sequelize, 'survey_questions', { allowNull: false }),
        answer_text: { type: Sequelize.TEXT, allowNull: true },
        answer_number: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
        answer_json: { type: Sequelize.JSON, allowNull: true },
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'survey_answers', [
      // 1 คำถาม ตอบได้คำตอบเดียวต่อ 1 response
      { name: 'uq_survey_answers_response_question', fields: ['response_id', 'question_id'], unique: true },
      { name: 'idx_survey_answers_question_id', fields: ['question_id'] },
    ]);

    // ---- notification_rules -----------------------------------------------
    await queryInterface.createTable(
      'notification_rules',
      {
        id: idColumn(Sequelize),
        name: { type: Sequelize.STRING(150), allowNull: false },
        event_type: { type: Sequelize.ENUM(...EVENT_TYPES), allowNull: false },
        days_before: { type: Sequelize.INTEGER, allowNull: true },
        is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        target_role_id: fk(Sequelize, 'roles', { allowNull: true }),
        target_user_id: fk(Sequelize, 'users', { allowNull: true }),
        message_template: { type: Sequelize.TEXT, allowNull: true },
        send_line: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        cron_expression: { type: Sequelize.STRING(100), allowNull: true },
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'notification_rules', [
      { name: 'idx_notification_rules_event_active', fields: ['event_type', 'is_active'] },
    ]);

    // ---- notifications (BR-11 ปลายทางเป็นพนักงานเท่านั้น) -----------------
    await queryInterface.createTable(
      'notifications',
      {
        id: idColumn(Sequelize),
        rule_id: fk(Sequelize, 'notification_rules', { allowNull: true, onDelete: 'SET NULL' }),
        target_user_id: fk(Sequelize, 'users', { allowNull: false }),
        event_type: { type: Sequelize.ENUM(...EVENT_TYPES), allowNull: false },
        title: { type: Sequelize.STRING(255), allowNull: false },
        message: { type: Sequelize.TEXT, allowNull: true },
        ref_type: { type: Sequelize.STRING(50), allowNull: true },
        ref_id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: true },
        status: {
          type: Sequelize.ENUM('PENDING', 'SENT', 'FAILED', 'READ'),
          allowNull: false,
          defaultValue: 'PENDING',
        },
        scheduled_at: { type: Sequelize.DATE, allowNull: true },
        sent_at: { type: Sequelize.DATE, allowNull: true },
        read_at: { type: Sequelize.DATE, allowNull: true },
        error_message: { type: Sequelize.TEXT, allowNull: true },
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'notifications', [
      { name: 'idx_notifications_target_status', fields: ['target_user_id', 'status'] },
      { name: 'idx_notifications_status_scheduled', fields: ['status', 'scheduled_at'] },
      { name: 'idx_notifications_event_type', fields: ['event_type'] },
      { name: 'idx_notifications_ref', fields: ['ref_type', 'ref_id'] },
    ]);
  },

  async down(queryInterface) {
    await dropTables(queryInterface, [
      'notifications',
      'notification_rules',
      'survey_answers',
      'survey_responses',
      'survey_assignments',
      'survey_questions',
      'surveys',
    ]);
  },
};
