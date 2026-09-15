/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { TABLE_OPTIONS, idColumn, auditColumns, fk, addIndexes, dropTables } = require('../migration-helpers');

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'task_submissions',
      {
        id: idColumn(Sequelize),
        task_id: fk(Sequelize, 'tasks', { allowNull: false, onDelete: 'RESTRICT' }),
        submitted_by_user_id: fk(Sequelize, 'users', { allowNull: false, onDelete: 'RESTRICT' }),
        report: { type: Sequelize.TEXT, allowNull: false },
        actual_hours: { type: Sequelize.DECIMAL(6, 2), allowNull: true },
        file_url: { type: Sequelize.STRING(500), allowNull: true },
        file_name: { type: Sequelize.STRING(255), allowNull: true },
        file_size: { type: Sequelize.BIGINT.UNSIGNED, allowNull: true },
        mime_type: { type: Sequelize.STRING(100), allowNull: true },
        status: {
          type: Sequelize.ENUM('PENDING', 'APPROVED', 'REJECTED'),
          allowNull: false,
          defaultValue: 'PENDING',
        },
        reviewed_by_user_id: fk(Sequelize, 'users', { allowNull: true, onDelete: 'SET NULL' }),
        reviewed_at: { type: Sequelize.DATE, allowNull: true },
        review_note: { type: Sequelize.TEXT, allowNull: true },
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'task_submissions', [
      { name: 'idx_task_submissions_task_status', fields: ['task_id', 'status', 'created_at'] },
      { name: 'idx_task_submissions_submitted_by', fields: ['submitted_by_user_id'] },
    ]);
  },

  async down(queryInterface) {
    await dropTables(queryInterface, ['task_submissions']);
  },
};
