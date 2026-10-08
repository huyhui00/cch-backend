'use strict';

/**
 * ลบสิทธิ์ที่ติ๊กแล้วไม่มีผล — ไม่มี endpoint รองรับและจะไม่มีตามกฎ (CLAUDE.md "ของที่ยังไม่ถูกใช้")
 * `task.assign` ไม่อยู่ในรายการ เพราะ TasksService ใช้ตรวจการมอบหมายงานย่อยจริง
 */
const REMOVED = [
  { code: 'user.delete', module: 'user', action: 'delete', description: 'ลบผู้ใช้งาน' },
  { code: 'project.delete', module: 'project', action: 'delete', description: 'ลบโครงการ' },
  { code: 'delivery.delete', module: 'delivery', action: 'delete', description: 'ลบการส่งมอบ' },
  { code: 'warranty.delete', module: 'warranty', action: 'delete', description: 'ลบการรับประกัน' },
  { code: 'ticket.delete', module: 'ticket', action: 'delete', description: 'ลบใบแจ้งปัญหา' },
  { code: 'audit.view', module: 'audit', action: 'view', description: 'ดูประวัติการใช้งาน' },
];

const CODES = REMOVED.map((row) => row.code);

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      'DELETE rp FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE p.code IN (:codes)',
      { replacements: { codes: CODES } },
    );
    await queryInterface.sequelize.query('DELETE FROM permissions WHERE code IN (:codes)', {
      replacements: { codes: CODES },
    });
  },

  async down(queryInterface) {
    const [existing] = await queryInterface.sequelize.query(
      'SELECT code FROM permissions WHERE code IN (:codes)',
      { replacements: { codes: CODES } },
    );
    const present = new Set(existing.map((row) => row.code));
    const now = new Date();
    const rows = REMOVED.filter((row) => !present.has(row.code)).map((row) => ({
      ...row,
      created_at: now,
      created_by: null,
      updated_at: now,
      updated_by: null,
      deleted_at: null,
      deleted_by: null,
    }));

    if (rows.length > 0) {
      await queryInterface.bulkInsert('permissions', rows);
    }
  },
};
