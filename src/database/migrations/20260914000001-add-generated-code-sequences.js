/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { TABLE_OPTIONS, addIndexes } = require('../migration-helpers');

function rememberMax(sequences, key, value) {
  const current = sequences.get(key) ?? 1;
  sequences.set(key, Math.max(current, value + 1));
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'code_sequences',
      {
        sequence_key: { type: Sequelize.STRING(100), allowNull: false, primaryKey: true },
        next_value: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
      },
      TABLE_OPTIONS,
    );

    await queryInterface.addColumn('warranties', 'warranty_no', {
      type: Sequelize.STRING(50),
      allowNull: true,
    });

    await addIndexes(queryInterface, 'warranties', [
      { name: 'uq_warranties_warranty_no', fields: ['warranty_no'], unique: true },
    ]);

    const sequences = new Map();
    const [customers] = await queryInterface.sequelize.query(
      'SELECT code FROM customers WHERE code IS NOT NULL',
    );
    for (const row of customers) {
      const match = /^CUS-(\d+)$/.exec(row.code);
      if (match) rememberMax(sequences, 'CUSTOMER', Number(match[1]));
    }

    const [projects] = await queryInterface.sequelize.query(
      'SELECT code FROM projects WHERE code IS NOT NULL',
    );
    for (const row of projects) {
      const match = /^PRJ-(\d{4})-(\d+)$/.exec(row.code);
      if (match) rememberMax(sequences, `PROJECT:${match[1]}`, Number(match[2]));
    }

    const [tickets] = await queryInterface.sequelize.query(
      'SELECT ticket_no AS ticketNo FROM tickets WHERE ticket_no IS NOT NULL',
    );
    for (const row of tickets) {
      const match = /^TK-(\d{4})-(\d+)$/.exec(row.ticketNo);
      if (match) rememberMax(sequences, `TICKET:${match[1]}`, Number(match[2]));
    }

    const [contracts] = await queryInterface.sequelize.query(
      'SELECT contract_no AS contractNo FROM ma_contracts WHERE contract_no IS NOT NULL',
    );
    for (const row of contracts) {
      const match = /^MA-(\d{4})-(\d+)$/.exec(row.contractNo);
      if (match) rememberMax(sequences, `MA_CONTRACT:${match[1]}`, Number(match[2]));
    }

    const [deliveries] = await queryInterface.sequelize.query(
      `SELECT d.delivery_no AS deliveryNo, d.project_id AS projectId, p.code AS projectCode
       FROM deliveries d
       INNER JOIN projects p ON p.id = d.project_id
       WHERE d.delivery_no IS NOT NULL AND p.code IS NOT NULL`,
    );
    for (const row of deliveries) {
      const prefix = `DLV-${row.projectCode}-`;
      if (row.deliveryNo.startsWith(prefix)) {
        const round = /-(\d{2})$/.exec(row.deliveryNo);
        if (round) rememberMax(sequences, `DELIVERY:${row.projectId}`, Number(round[1]));
      }
    }

    for (const [sequenceKey, nextValue] of sequences) {
      await queryInterface.bulkInsert('code_sequences', [{ sequence_key: sequenceKey, next_value: nextValue }]);
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('warranties', 'warranty_no');
    await queryInterface.dropTable('code_sequences');
  },
};