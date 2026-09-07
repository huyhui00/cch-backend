import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';

import { ALL_MODELS } from '../models';

const sequelizeLogger = new Logger('Sequelize');

/**
 * ค่าใน .env เป็น string เสมอ และ ConfigService.get<number>() ไม่ได้แปลงชนิดให้
 * (generic เป็นแค่ type assertion) ถ้าส่ง string ต่อเข้า sequelize-pool จะพังทันที
 * ด้วย "min must be an integer >= 0" จึงต้องแปลงเป็นตัวเลขเองทุกครั้ง
 */
function toInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

@Module({
  imports: [
    SequelizeModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        dialect: 'mysql' as const,
        host: config.get<string>('DB_HOST', '127.0.0.1'),
        port: toInt(config.get('DB_PORT'), 3306),
        username: config.get<string>('DB_USERNAME', 'root'),
        password: config.get<string>('DB_PASSWORD', ''),
        database: config.get<string>('DB_DATABASE', 'cch_db'),

        // เก็บและอ่านเวลาเป็นเวลาไทยให้ตรงกันทั้งระบบ
        timezone: config.get<string>('DB_TIMEZONE', '+07:00'),

        // ลงทะเบียนทั้ง 30 ตารางไว้ที่ระดับ connection
        // ส่วน autoLoadModels ไว้รับ model ที่ module ทางธุรกิจ register เพิ่มผ่าน forFeature()
        models: ALL_MODELS,
        autoLoadModels: true,

        // โครงสร้างตารางมาจาก migration เท่านั้น ห้ามให้ Sequelize แก้ schema เอง
        synchronize: false,

        // ค่า default ของทุก model ตาม CLAUDE.md 6.2 / 6.3
        define: {
          underscored: true, // DB เป็น snake_case แต่ TS เป็น camelCase
          timestamps: true, // created_at, updated_at
          paranoid: true, // soft delete ผ่าน deleted_at
          freezeTableName: false, // ชื่อตารางเป็นพหูพจน์
          charset: 'utf8mb4',
          collate: 'utf8mb4_unicode_ci',
        },

        pool: {
          max: toInt(config.get('DB_POOL_MAX'), 10),
          min: toInt(config.get('DB_POOL_MIN'), 0),
          acquire: 30000,
          idle: 10000,
        },

        retryAttempts: 3,
        retryDelay: 3000,

        logging:
          config.get<string>('DB_LOGGING', 'false') === 'true'
            ? (sql: string) => sequelizeLogger.debug(sql)
            : false,
      }),
    }),
  ],
})
export class DatabaseModule {}
