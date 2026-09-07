/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const {
  TABLE_OPTIONS,
  idColumn,
  auditColumns,
  createdOnlyColumns,
  fk,
  addIndexes,
  dropTables,
} = require('../migration-helpers');

/**
 * กลุ่ม A — Auth & RBAC
 *   users, roles, permissions, user_roles, role_permissions, audit_logs
 *
 * ต้องรันเป็นไฟล์แรกเสมอ เพราะทุกกลุ่มที่เหลืออ้างถึง users
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // ---- users ------------------------------------------------------------
    await queryInterface.createTable(
      'users',
      {
        id: idColumn(Sequelize),
        employee_code: { type: Sequelize.STRING(50), allowNull: true },
        username: { type: Sequelize.STRING(100), allowNull: false },
        email: { type: Sequelize.STRING(255), allowNull: true },
        password_hash: { type: Sequelize.STRING(255), allowNull: false },
        full_name: { type: Sequelize.STRING(255), allowNull: false },
        nickname: { type: Sequelize.STRING(100), allowNull: true },
        phone: { type: Sequelize.STRING(30), allowNull: true },
        position: { type: Sequelize.STRING(150), allowNull: true },
        avatar_url: { type: Sequelize.STRING(500), allowNull: true },
        line_user_id: { type: Sequelize.STRING(100), allowNull: true },
        account_type: {
          type: Sequelize.ENUM('SUPER_ADMIN', 'ADMIN', 'USER'),
          allowNull: false,
          defaultValue: 'USER',
        },
        status: {
          type: Sequelize.ENUM('ACTIVE', 'SUSPENDED', 'RESIGNED'),
          allowNull: false,
          defaultValue: 'ACTIVE',
        },
        last_login_at: { type: Sequelize.DATE, allowNull: true },
        refresh_token_hash: { type: Sequelize.STRING(255), allowNull: true },
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'users', [
      { name: 'uq_users_username', fields: ['username'], unique: true },
      { name: 'uq_users_email', fields: ['email'], unique: true },
      { name: 'uq_users_employee_code', fields: ['employee_code'], unique: true },
      { name: 'idx_users_status_account_type', fields: ['status', 'account_type'] },
    ]);

    // ---- roles ------------------------------------------------------------
    await queryInterface.createTable(
      'roles',
      {
        id: idColumn(Sequelize),
        name: { type: Sequelize.STRING(100), allowNull: false },
        description: { type: Sequelize.STRING(255), allowNull: true },
        is_system: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'roles', [
      { name: 'uq_roles_name', fields: ['name'], unique: true },
    ]);

    // ---- permissions ------------------------------------------------------
    await queryInterface.createTable(
      'permissions',
      {
        id: idColumn(Sequelize),
        code: { type: Sequelize.STRING(100), allowNull: false },
        module: { type: Sequelize.STRING(50), allowNull: false },
        action: { type: Sequelize.STRING(50), allowNull: false },
        description: { type: Sequelize.STRING(255), allowNull: true },
        ...auditColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'permissions', [
      { name: 'uq_permissions_code', fields: ['code'], unique: true },
      { name: 'idx_permissions_module', fields: ['module'] },
    ]);

    // ---- user_roles (junction, composite PK) ------------------------------
    await queryInterface.createTable(
      'user_roles',
      {
        user_id: {
          ...fk(Sequelize, 'users', { allowNull: false, onDelete: 'CASCADE' }),
          primaryKey: true,
        },
        role_id: {
          ...fk(Sequelize, 'roles', { allowNull: false, onDelete: 'CASCADE' }),
          primaryKey: true,
        },
        ...createdOnlyColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'user_roles', [
      { name: 'idx_user_roles_role_id', fields: ['role_id'] },
    ]);

    // ---- role_permissions (junction, composite PK) ------------------------
    await queryInterface.createTable(
      'role_permissions',
      {
        role_id: {
          ...fk(Sequelize, 'roles', { allowNull: false, onDelete: 'CASCADE' }),
          primaryKey: true,
        },
        permission_id: {
          ...fk(Sequelize, 'permissions', { allowNull: false, onDelete: 'CASCADE' }),
          primaryKey: true,
        },
        ...createdOnlyColumns(Sequelize),
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'role_permissions', [
      { name: 'idx_role_permissions_permission_id', fields: ['permission_id'] },
    ]);

    // ---- audit_logs (append-only, BR-09) ----------------------------------
    await queryInterface.createTable(
      'audit_logs',
      {
        id: idColumn(Sequelize),
        user_id: fk(Sequelize, 'users', { allowNull: true }),
        action: { type: Sequelize.STRING(50), allowNull: false },
        table_name: { type: Sequelize.STRING(100), allowNull: false },
        record_id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: true },
        old_value: { type: Sequelize.JSON, allowNull: true },
        new_value: { type: Sequelize.JSON, allowNull: true },
        ip_address: { type: Sequelize.STRING(45), allowNull: true },
        user_agent: { type: Sequelize.STRING(500), allowNull: true },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'audit_logs', [
      {
        name: 'idx_audit_logs_table_record_created',
        fields: ['table_name', 'record_id', 'created_at'],
      },
      { name: 'idx_audit_logs_user_created', fields: ['user_id', 'created_at'] },
      { name: 'idx_audit_logs_action', fields: ['action'] },
    ]);
  },

  async down(queryInterface) {
    // ลำดับย้อนกลับของตอนสร้าง เพื่อไม่ให้ foreign key ค้าง
    await dropTables(queryInterface, [
      'audit_logs',
      'role_permissions',
      'user_roles',
      'permissions',
      'roles',
      'users',
    ]);
  },
};
