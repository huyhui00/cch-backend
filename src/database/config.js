/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * config สำหรับ sequelize-cli เท่านั้น (migration / seeder)
 * runtime ของแอปใช้ database.module.ts ไม่ได้ใช้ไฟล์นี้
 * แต่ทั้งสองอ่านค่าจาก .env ตัวเดียวกัน
 */
require('dotenv').config();

const base = {
  dialect: 'mysql',
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  username: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'cch_db',
  timezone: process.env.DB_TIMEZONE || '+07:00',
  logging: process.env.DB_LOGGING === 'true' ? console.log : false,
  define: {
    underscored: true,
    timestamps: true,
    paranoid: true,
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
  },
  migrationStorageTableName: 'sequelize_meta',
  seederStorage: 'sequelize',
  seederStorageTableName: 'sequelize_seeder_meta',
};

module.exports = {
  development: base,
  test: { ...base, database: `${base.database}_test` },
  production: base,
};
