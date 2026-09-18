const { Sequelize } = require('sequelize');
require('dotenv').config();

const s = new Sequelize(
  process.env.DB_DATABASE,
  process.env.DB_USERNAME,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    dialect: 'mysql',
    logging: false,
  },
);

(async () => {
  const [r] = await s.query(
    `DELETE a FROM ma_addons a
     INNER JOIN ma_contracts c ON c.id = a.contract_id
     WHERE c.contract_no = 'MA-2026-001'`,
  );
  console.log('removed addons for MA-2026-001', r);
  const [usages] = await s.query('SELECT COUNT(*) AS c FROM ma_usages');
  console.log('ma_usages count:', usages[0].c);
  await s.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
