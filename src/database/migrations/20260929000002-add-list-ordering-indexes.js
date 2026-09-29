'use strict';

/**
 * index สำหรับรายการที่เรียงใหม่ไปเก่าของตารางที่โตเร็วที่สุด (ประวัติการใช้งาน / แจ้งเตือน)
 * ไม่มี index เหล่านี้ MySQL ต้องเรียงทั้งตารางทุกครั้งที่เปิดหน้า — ช้าลงตามจำนวนแถวที่สะสมไปเรื่อย ๆ
 * InnoDB ต่อ id ท้าย secondary index ให้เอง จึงรองรับลำดับ (created_at, id) ของ cursor ได้ครบ
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex('audit_logs', ['created_at'], {
      name: 'idx_audit_logs_created_at',
    });
    await queryInterface.addIndex('audit_logs', ['table_name', 'created_at'], {
      name: 'idx_audit_logs_table_created',
    });
    await queryInterface.addIndex('notifications', ['target_user_id', 'created_at'], {
      name: 'idx_notifications_target_created',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('notifications', 'idx_notifications_target_created');
    await queryInterface.removeIndex('audit_logs', 'idx_audit_logs_table_created');
    await queryInterface.removeIndex('audit_logs', 'idx_audit_logs_created_at');
  },
};
