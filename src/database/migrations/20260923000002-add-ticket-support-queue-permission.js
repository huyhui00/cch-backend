/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/**
 * C-1 — แยกสิทธิ์คิวซัพพอร์ตจากหน้าปัญหา
 *
 * เดิม GET /tickets/support-queue ใช้ ticket.view ทำให้คนที่เปิดใบได้อย่างเดียว
 * (ticket.create) หรือแค่ดูใบ เห็นคิวซัพพอร์ตด้วย
 *
 * ticket.support_queue = เข้าคิวซัพพอร์ต + ส่งหัวหน้า + บอกลูกค้าบนคิวนี้
 * ไม่รวมในบทบาทที่เปิดใบอย่างเดียว
 *
 * role_permissions เป็น junction ที่ใช้ createdOnlyColumns — มีแค่ created_at/created_by
 */
const CODE = 'ticket.support_queue';

/** บทบาทเดโมที่ควรถือคิวซัพพอร์ต (ไม่ใส่ Developer / หัวหน้าจัดแจงอย่างเดียว) */
const SUPPORT_ROLE_NAMES = [
  'ดูแลใบแจ้งปัญหา',
  'ฝ่ายซัพพอร์ต',
  'ซัพพอร์ตรับเรื่อง',
  'ดูแลลูกค้าและใบแจ้งปัญหา',
];

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    const [existing] = await queryInterface.sequelize.query(
      'SELECT id FROM permissions WHERE code = :code LIMIT 1',
      { replacements: { code: CODE } },
    );

    let permissionId = existing[0]?.id;

    if (!permissionId) {
      await queryInterface.bulkInsert('permissions', [
        {
          code: CODE,
          module: 'ticket',
          action: 'support_queue',
          description: 'เข้าคิวซัพพอร์ต (รอส่งหัวหน้า · แอดมินส่งกลับมา · บอกลูกค้า)',
          created_at: now,
          created_by: null,
          updated_at: now,
          updated_by: null,
          deleted_at: null,
          deleted_by: null,
        },
      ]);

      const [perms] = await queryInterface.sequelize.query(
        'SELECT id FROM permissions WHERE code = :code AND deleted_at IS NULL LIMIT 1',
        { replacements: { code: CODE } },
      );
      permissionId = perms[0]?.id;
    }

    if (!permissionId) {
      return;
    }

    const [roles] = await queryInterface.sequelize.query(
      'SELECT id FROM roles WHERE name IN (:names) AND deleted_at IS NULL',
      { replacements: { names: SUPPORT_ROLE_NAMES } },
    );

    if (roles.length === 0) {
      return;
    }

    const [alreadyLinked] = await queryInterface.sequelize.query(
      'SELECT role_id FROM role_permissions WHERE permission_id = :permissionId',
      { replacements: { permissionId } },
    );
    const linked = new Set(alreadyLinked.map((row) => Number(row.role_id)));

    const rows = roles
      .filter((role) => !linked.has(Number(role.id)))
      .map((role) => ({
        role_id: role.id,
        permission_id: permissionId,
        created_at: now,
        created_by: null,
      }));

    if (rows.length > 0) {
      await queryInterface.bulkInsert('role_permissions', rows);
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'DELETE rp FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE p.code = :code',
      { replacements: { code: CODE } },
    );
    await queryInterface.bulkDelete('permissions', { code: CODE });
  },
};
