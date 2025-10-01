import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function setupAuthDatabase() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL2_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL2_PORT) || 3306,
    user: process.env.MYSQL2_USER || 'admin',
    password: process.env.MYSQL2_PASSWORD || 'admin'
  });

  try {
    // Create database if not exists
    const databaseName = process.env.MYSQL2_DATABASE || 'libdashboard';
    await connection.execute(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\``);
    console.log(`Database '${databaseName}' created or already exists`);

    // Use the database
    await connection.execute(`USE \`${databaseName}\``);

    // Read and execute schema file
    const schemaPath = path.join(__dirname, '..', 'database', 'auth_schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // Split by semicolon and execute each statement
    const statements = schema.split(';').filter(stmt => stmt.trim().length > 0);
    
    for (const statement of statements) {
      try {
        await connection.execute(statement);
        console.log('Executed:', statement.substring(0, 50).replace(/\s+/g, ' ') + '...');
      } catch (error: any) {
        if (!error.message.includes('already exists')) {
          console.error('Error executing statement:', error.message);
        }
      }
    }

    console.log('Auth database setup completed successfully!');
  } catch (error) {
    console.error('Error setting up auth database:', error);
    throw error;
  } finally {
    await connection.end();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  setupAuthDatabase()
    .then(() => {
      console.log('Setup completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Setup failed:', error);
      process.exit(1);
    });
}

export { setupAuthDatabase };