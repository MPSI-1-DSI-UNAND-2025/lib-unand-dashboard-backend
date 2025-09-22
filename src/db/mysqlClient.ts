import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || '10.44.7.43',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'mpsi',
  password: process.env.MYSQL_PASSWORD || 'mpsi',
  database: process.env.MYSQL_DATABASE || 'slims',
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_POOL_LIMIT || 10),
  timezone: 'Z',
});

export async function pingMySQL() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
    console.log('[mysql] ping success');
  } finally {
    conn.release();
  }
}

export { pool };
