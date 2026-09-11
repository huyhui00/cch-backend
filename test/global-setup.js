/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * เตรียมฐานข้อมูลทดสอบก่อนรัน e2e ทั้งชุด
 *
 * ใช้ฐานข้อมูลแยกชื่อ `<DB_DATABASE>_test` เสมอ ตามที่ src/database/config.js
 * ตั้งไว้ให้ env `test` อยู่แล้ว จึงไม่มีทางที่เทสต์จะไปเขียนทับข้อมูลที่ใช้พัฒนา
 *
 * โครงสร้างตารางมาจาก migration ชุดเดียวกับของจริง ไม่ได้ใช้ synchronize
 * เพราะถ้าใช้คนละทาง เทสต์จะผ่านบนตารางที่ไม่เหมือนกับที่รันจริง
 */
require('dotenv').config();

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const mysql = require('mysql2/promise');

/** ต้องตรงกับ LOCAL_STORAGE_DIR ที่ test/setup-env.js ตั้งไว้ */
const E2E_UPLOAD_DIR = path.join(os.tmpdir(), 'cch-backend-e2e-uploads');

/**
 * เรียกไฟล์ entry ของ sequelize-cli ด้วย node ตรง ๆ ไม่ผ่าน npx
 *
 * บน Windows การ execFileSync ไปที่ `npx.cmd` ได้ EINVAL เพราะ Node รุ่นใหม่
 * ไม่ยอมรันไฟล์ .cmd โดยไม่มี shell และการเปิด shell ก็เปิดช่องให้ค่าใน argument
 * ถูกตีความ วิธีนี้เลี่ยงทั้งสองปัญหาและได้ผลเหมือนกันทุกระบบปฏิบัติการ
 */
const SEQUELIZE_CLI = path.join(
  __dirname,
  '..',
  'node_modules',
  'sequelize-cli',
  'lib',
  'sequelize',
);

module.exports = async function globalSetup() {
  const base = process.env.DB_DATABASE || 'cch_db';
  const database = base.endsWith('_test') ? base : `${base}_test`;

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
  });

  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  );
  await connection.end();

  // --env test ทำให้ sequelize-cli อ่าน block `test` ใน config.js ที่ชี้ไปฐานทดสอบ
  // ทั้งสองคำสั่งข้ามงานที่ทำไปแล้วเอง จึงรันซ้ำได้โดยไม่ต้องล้างฐานทุกครั้ง
  const run = (args) =>
    execFileSync(process.execPath, [SEQUELIZE_CLI, ...args, '--env', 'test'], {
      stdio: 'inherit',
      env: process.env,
    });

  run(['db:migrate']);
  run(['db:seed:all']);

  // ไฟล์ที่ e2e อัปโหลดรอบก่อน (documents.e2e-spec) ไม่มีใครอ่านอีกแล้ว ล้างทิ้งก่อนเริ่ม
  // ไม่งั้นโฟลเดอร์ชั่วคราวจะโตขึ้นทุกครั้งที่รัน — ฐานทดสอบไม่ถูกล้าง แต่แถวเก่าไม่ได้ถูกดาวน์โหลดซ้ำ
  fs.rmSync(E2E_UPLOAD_DIR, { recursive: true, force: true });
};
