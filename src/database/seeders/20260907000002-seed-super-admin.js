/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

require('dotenv').config();
const bcrypt = require('bcrypt');

/**
 * สร้างบัญชี SUPER_ADMIN 1 บัญชีตอน setup ระบบ (CLAUDE.md 4.1)
 *
 * SUPER_ADMIN ไม่ต้องผูก Role เพราะ bypass permission check ทั้งหมด
 * seeder นี้จึงไม่แตะตาราง user_roles เลย
 *
 * รหัสผ่านอ่านจาก .env เท่านั้น ไม่มีค่า default โดยเจตนา —
 * บัญชีที่มีสิทธิ์สูงสุดของระบบต้องไม่มีรหัสผ่านที่เดาได้จากซอร์สโค้ด
 */
module.exports = {
  async up(queryInterface) {
    const username = process.env.SUPER_ADMIN_USERNAME || 'superadmin';
    const password = process.env.SUPER_ADMIN_PASSWORD;
    const email = process.env.SUPER_ADMIN_EMAIL || null;
    const fullName = process.env.SUPER_ADMIN_FULL_NAME || 'Super Admin';
    const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS || 10);

    if (!password) {
      throw new Error(
        'ไม่พบ SUPER_ADMIN_PASSWORD ใน .env — ตั้งค่าก่อนรัน seed ' +
          '(ห้ามใช้รหัสผ่าน default กับบัญชีที่มีสิทธิ์สูงสุดของระบบ)',
      );
    }

    if (password.length < 12) {
      throw new Error('SUPER_ADMIN_PASSWORD ต้องยาวอย่างน้อย 12 ตัวอักษร');
    }

    const [existing] = await queryInterface.sequelize.query(
      'SELECT id FROM users WHERE username = :username LIMIT 1',
      { replacements: { username } },
    );

    if (existing.length > 0) {
      console.log(`super admin: มีบัญชี "${username}" อยู่แล้ว ข้ามการสร้าง`);
      return;
    }

    const now = new Date();
    const passwordHash = await bcrypt.hash(password, saltRounds);

    await queryInterface.bulkInsert('users', [
      {
        employee_code: null,
        username,
        email,
        password_hash: passwordHash,
        full_name: fullName,
        nickname: null,
        phone: null,
        position: 'ผู้ดูแลระบบสูงสุด',
        avatar_url: null,
        line_user_id: null,
        account_type: 'SUPER_ADMIN',
        status: 'ACTIVE',
        last_login_at: null,
        refresh_token_hash: null,
        created_at: now,
        created_by: null,
        updated_at: now,
        updated_by: null,
        deleted_at: null,
        deleted_by: null,
      },
    ]);

    console.log(`super admin: สร้างบัญชี "${username}" เรียบร้อย`);
  },

  async down(queryInterface) {
    const username = process.env.SUPER_ADMIN_USERNAME || 'superadmin';

    // ลบจริงได้เฉพาะตอน rollback seed เท่านั้น
    // ในการใช้งานปกติห้ามลบ user ทิ้ง (CLAUDE.md 4.3)
    await queryInterface.bulkDelete('users', { username, account_type: 'SUPER_ADMIN' });
  },
};
