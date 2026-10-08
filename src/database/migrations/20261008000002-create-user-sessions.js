/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { TABLE_OPTIONS, idColumn, fk, addIndexes, dropTables } = require('../migration-helpers');

const REFRESH_TTL_DAYS = 7;

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'user_sessions',
      {
        id: idColumn(Sequelize),
        user_id: fk(Sequelize, 'users', { allowNull: false, onDelete: 'CASCADE' }),
        refresh_token_hash: { type: Sequelize.STRING(255), allowNull: false },
        user_agent: { type: Sequelize.STRING(500), allowNull: true },
        ip_address: { type: Sequelize.STRING(45), allowNull: true },
        last_used_at: { type: Sequelize.DATE, allowNull: false },
        expires_at: { type: Sequelize.DATE, allowNull: false },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      },
      TABLE_OPTIONS,
    );

    await addIndexes(queryInterface, 'user_sessions', [
      { name: 'idx_user_sessions_user_expires', fields: ['user_id', 'expires_at'] },
    ]);

    await queryInterface.sequelize.query(
      `INSERT INTO user_sessions
         (user_id, refresh_token_hash, last_used_at, expires_at, created_at, updated_at)
       SELECT id, refresh_token_hash, NOW(), DATE_ADD(NOW(), INTERVAL ${REFRESH_TTL_DAYS} DAY), NOW(), NOW()
       FROM users
       WHERE refresh_token_hash IS NOT NULL`,
    );

    await queryInterface.sequelize.query(
      'UPDATE users SET refresh_token_hash = NULL WHERE refresh_token_hash IS NOT NULL',
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE users u
       JOIN (
         SELECT s.user_id, s.refresh_token_hash
         FROM user_sessions s
         JOIN (SELECT user_id, MAX(id) AS id FROM user_sessions GROUP BY user_id) latest
           ON latest.id = s.id
       ) last_session ON last_session.user_id = u.id
       SET u.refresh_token_hash = last_session.refresh_token_hash`,
    );

    await dropTables(queryInterface, ['user_sessions']);
  },
};
