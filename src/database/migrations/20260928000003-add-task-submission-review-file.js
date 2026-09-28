'use strict';

/**
 * ไฟล์แนบของผู้ตรวจตอนส่งงานกลับแก้ (ประชุมทบทวน 22–23 ก.ย. นาที 00:12)
 * แยกคอลัมน์จากไฟล์รายงานของผู้ส่ง เพราะเป็นคนละไฟล์ คนละผู้กระทำ
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('task_submissions', 'review_file_url', {
      type: Sequelize.STRING(500),
      allowNull: true,
      after: 'review_note',
    });
    await queryInterface.addColumn('task_submissions', 'review_file_name', {
      type: Sequelize.STRING(255),
      allowNull: true,
      after: 'review_file_url',
    });
    await queryInterface.addColumn('task_submissions', 'review_file_size', {
      type: Sequelize.BIGINT.UNSIGNED,
      allowNull: true,
      after: 'review_file_name',
    });
    await queryInterface.addColumn('task_submissions', 'review_mime_type', {
      type: Sequelize.STRING(100),
      allowNull: true,
      after: 'review_file_size',
    });
    await queryInterface.addIndex('task_submissions', ['reviewed_by_user_id', 'reviewed_at'], {
      name: 'idx_task_submissions_reviewer',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('task_submissions', 'idx_task_submissions_reviewer');
    await queryInterface.removeColumn('task_submissions', 'review_mime_type');
    await queryInterface.removeColumn('task_submissions', 'review_file_size');
    await queryInterface.removeColumn('task_submissions', 'review_file_name');
    await queryInterface.removeColumn('task_submissions', 'review_file_url');
  },
};
