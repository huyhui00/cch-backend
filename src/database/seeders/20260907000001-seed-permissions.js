/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/**
 * Master data ของ permissions ทั้งระบบ
 * รูปแบบ code = `module.action` (CLAUDE.md 4.2)
 *
 * หมายเหตุ role.manage: ใส่ไว้เพื่อความครบถ้วนของรายการ แต่ในทางปฏิบัติ
 * ติ๊กให้ role ไหนก็ไม่มีผล เพราะ PermissionsGuard ตัดทิ้งให้ทุกคนที่ไม่ใช่
 * SUPER_ADMIN อยู่แล้ว (CLAUDE.md 9.4) — BR-10 บังคับให้สิทธิ์นี้ผูกกับ
 * account_type ไม่ใช่ permission ที่ติ๊กได้
 */
const PERMISSION_GROUPS = [
  {
    name: 'user',
    label: 'ผู้ใช้งาน',
    actions: ['view', 'create', 'update', 'delete', 'reset_password'],
  },
  { name: 'role', label: 'บทบาทและสิทธิ์', actions: ['view', 'manage'] },
  { name: 'permission', label: 'รายการสิทธิ์', actions: ['view'] },
  { name: 'customer', label: 'ลูกค้า', actions: ['view', 'create', 'update', 'delete', 'export'] },
  { name: 'contact', label: 'ผู้ติดต่อ', actions: ['view', 'create', 'update', 'delete'] },
  {
    name: 'communication',
    label: 'บันทึกการติดต่อ',
    actions: ['view', 'create', 'update', 'delete'],
  },
  { name: 'project', label: 'โครงการ', actions: ['view', 'create', 'update', 'delete'] },
  { name: 'task', label: 'งานย่อย', actions: ['view', 'create', 'update', 'delete', 'assign'] },
  {
    name: 'delivery',
    label: 'การส่งมอบ',
    actions: ['view', 'create', 'update', 'delete', 'accept'],
  },
  { name: 'warranty', label: 'การรับประกัน', actions: ['view', 'create', 'update', 'delete'] },
  {
    name: 'ticket',
    label: 'ใบแจ้งปัญหา',
    actions: ['view', 'create', 'update', 'delete', 'assign', 'resolve', 'reopen', 'close'],
  },
  { name: 'ma', label: 'สัญญา MA', actions: ['view', 'create', 'update', 'delete', 'renew'] },
  { name: 'document', label: 'เอกสาร', actions: ['view', 'create', 'update', 'delete'] },
  { name: 'file', label: 'ไฟล์แนบ', actions: ['view', 'upload', 'download', 'delete'] },
  {
    name: 'followup',
    label: 'งานติดตาม',
    actions: ['view', 'create', 'update', 'delete', 'complete'],
  },
  { name: 'survey', label: 'แบบประเมิน', actions: ['view', 'create', 'update', 'delete', 'send'] },
  { name: 'report', label: 'รายงาน', actions: ['view', 'export'] },
  { name: 'notification', label: 'การแจ้งเตือน', actions: ['view', 'manage'] },
  { name: 'audit', label: 'ประวัติการใช้งาน', actions: ['view'] },
];

const ACTION_LABELS = {
  view: 'ดู',
  create: 'เพิ่ม',
  update: 'แก้ไข',
  delete: 'ลบ',
  export: 'ส่งออก',
  assign: 'มอบหมาย',
  resolve: 'บันทึกผลการแก้ไข',
  reopen: 'เปิดใหม่',
  close: 'ปิด',
  accept: 'ยืนยันการรับมอบ',
  renew: 'ต่อสัญญา',
  upload: 'อัปโหลด',
  download: 'ดาวน์โหลด',
  complete: 'ปิดงาน',
  send: 'ส่ง',
  manage: 'จัดการ',
  reset_password: 'รีเซ็ตรหัสผ่าน',
};

function buildRows() {
  const now = new Date();
  const rows = [];

  for (const group of PERMISSION_GROUPS) {
    for (const action of group.actions) {
      rows.push({
        code: `${group.name}.${action}`,
        module: group.name,
        action,
        description: `${ACTION_LABELS[action] || action}${group.label}`,
        created_at: now,
        created_by: null,
        updated_at: now,
        updated_by: null,
        deleted_at: null,
        deleted_by: null,
      });
    }
  }

  return rows;
}

module.exports = {
  async up(queryInterface) {
    const rows = buildRows();

    // กันการ seed ซ้ำ — ข้าม code ที่มีอยู่แล้ว
    const [existing] = await queryInterface.sequelize.query('SELECT code FROM permissions');
    const existingCodes = new Set(existing.map((row) => row.code));
    const toInsert = rows.filter((row) => !existingCodes.has(row.code));

    if (toInsert.length === 0) {
      console.log('permissions: มีครบอยู่แล้ว ไม่ต้องเพิ่ม');
      return;
    }

    await queryInterface.bulkInsert('permissions', toInsert);
    console.log(`permissions: เพิ่ม ${toInsert.length} รายการ (ทั้งหมด ${rows.length} รายการ)`);
  },

  async down(queryInterface) {
    const { Op } = queryInterface.sequelize.Sequelize;
    const codes = buildRows().map((row) => row.code);

    // ถอด role_permissions ที่ชี้มาก่อน ไม่งั้นติด foreign key
    await queryInterface.sequelize.query(
      'DELETE rp FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE p.code IN (:codes)',
      { replacements: { codes } },
    );

    await queryInterface.bulkDelete('permissions', { code: { [Op.in]: codes } });
  },
};
