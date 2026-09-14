/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('tickets', 'status', {
      type: Sequelize.ENUM('RECEIVED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'REOPENED', 'CLOSED'),
      allowNull: false,
      defaultValue: 'RECEIVED',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('tickets', 'status', {
      type: Sequelize.ENUM('RECEIVED', 'IN_PROGRESS', 'RESOLVED', 'REOPENED', 'CLOSED'),
      allowNull: false,
      defaultValue: 'RECEIVED',
    });
  },
};