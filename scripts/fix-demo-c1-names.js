/**
 * จัดบัญชีเดโมในฐานที่มีอยู่แล้วให้ตรง C-1 (รันครั้งเดียว)
 * node scripts/fix-demo-c1-names.js
 */
require('dotenv').config();
const { Sequelize } = require('sequelize');

const s = new Sequelize(process.env.DB_DATABASE, process.env.DB_USERNAME, process.env.DB_PASSWORD, {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  dialect: 'mysql',
  logging: false,
});

(async () => {
  const now = new Date();
  const [[sa]] = await s.query(
    "SELECT id FROM users WHERE account_type = 'SUPER_ADMIN' AND deleted_at IS NULL ORDER BY id LIMIT 1",
  );
  const actor = sa?.id || null;

  const setPos = async (username, position) => {
    await s.query(
      'UPDATE users SET position = :position, updated_at = :now, updated_by = :actor WHERE username = :username AND deleted_at IS NULL',
      { replacements: { position, now, actor, username } },
    );
  };

  await setPos('Tom', 'เจ้าหน้าที่ซัพพอร์ต');
  await setPos('pranee', 'เจ้าหน้าที่ฝ่ายขาย');
  await setPos('wichai', 'พนักงานแก้ใบ');

  const [roles] = await s.query(
    "SELECT id, name FROM roles WHERE name IN ('ซัพพอร์ตรับเรื่อง','ดูแลลูกค้าและงานขาย','พนักงานแก้ใบ')",
  );
  const roleId = Object.fromEntries(roles.map((r) => [r.name, r.id]));

  const [users] = await s.query(
    "SELECT id, username FROM users WHERE username IN ('Tom','pranee','wichai') AND deleted_at IS NULL",
  );
  const userId = Object.fromEntries(users.map((u) => [u.username, u.id]));

  if (!userId.Tom || !userId.pranee || !userId.wichai) {
    throw new Error('ขาดบัญชี Tom/pranee/wichai');
  }

  await s.query('DELETE FROM user_roles WHERE user_id IN (:ids)', {
    replacements: { ids: [userId.Tom, userId.pranee, userId.wichai] },
  });

  await s.query(
    `INSERT INTO user_roles (user_id, role_id, created_at, created_by) VALUES
      (:tom, :support, :now, :actor),
      (:pranee, :sales, :now, :actor),
      (:wichai, :staff, :now, :actor)`,
    {
      replacements: {
        tom: userId.Tom,
        pranee: userId.pranee,
        wichai: userId.wichai,
        support: roleId['ซัพพอร์ตรับเรื่อง'],
        sales: roleId['ดูแลลูกค้าและงานขาย'],
        staff: roleId['พนักงานแก้ใบ'],
        now,
        actor,
      },
    },
  );

  const [check] = await s.query(`
    SELECT u.username, u.position, u.account_type, r.name AS role_name
    FROM users u
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles r ON r.id = ur.role_id
    WHERE u.username IN ('SuperAdmin','somchai','Tom','pranee','wichai')
      AND u.deleted_at IS NULL
    ORDER BY u.username
  `);
  console.log(check);
  await s.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
