import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

async function setupSimpleDatabase() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL2_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL2_PORT) || 3306,
    user: process.env.MYSQL2_USER || 'admin',
    password: process.env.MYSQL2_PASSWORD || 'admin',
    multipleStatements: true
  });

  try {
    // Read SQL file
    const sqlPath = path.join(__dirname, '../../database/simple_auth.sql');
    const raw = fs.readFileSync(sqlPath, 'utf8');
    // Split on semicolons at line ends; ignore empty statements & comments
    const statements = raw
      .split(/;\s*\n/)
      .map(s => s.trim())
      .filter(s => s.length && !s.startsWith('--'));

    console.log('Setting up simple auth database...');
    for (const stmt of statements) {
      try {
        await connection.query(stmt);
      } catch (err: any) {
        if (err.code === 'ER_TABLE_EXISTS_ERROR') {
          console.log('Table already exists, skipping');
          continue;
        }
        // Ignore duplicate admin insert
        if (err.code === 'ER_DUP_ENTRY') {
          console.log('Admin user already exists, skipping insert');
          continue;
        }
        throw err;
      }
    }
    console.log('✅ Simple auth database setup completed successfully!');

  // Switch DB (use query not execute to avoid prepared statement limitation)
  await connection.query('USE libdashboard');
  const [rows] = await connection.query('SELECT COUNT(*) as count FROM users');
    console.log(`✅ Users table created with ${(rows as any)[0].count} records`);

  } catch (error) {
    console.error('❌ Error setting up simple auth database:', error);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

setupSimpleDatabase();