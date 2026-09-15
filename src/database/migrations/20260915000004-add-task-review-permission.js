/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.bulkInsert('permissions', [
      {
        code: 'task.review',
        module: 'task',
        action: 'review',
        description: 'ตรวจงานย่อย',
        created_at: new Date(),
        created_by: null,
        updated_at: new Date(),
        updated_by: null,
        deleted_at: null,
        deleted_by: null,
      },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'DELETE rp FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE p.code = :code',
      { replacements: { code: 'task.review' } },
    );
    await queryInterface.bulkDelete('permissions', { code: 'task.review' });
  },
};