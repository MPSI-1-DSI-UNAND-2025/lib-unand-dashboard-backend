import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

// Prefer MYSQL_* variables (consistent with mysqlClient.ts and .env); fall back to legacy DB_* if provided.
const MYSQL_HOST = process.env.MYSQL_HOST || process.env.DB_HOST || 'localhost';
const MYSQL_PORT = process.env.MYSQL_PORT || process.env.DB_PORT || '3306';
const MYSQL_USER = process.env.MYSQL_USER || process.env.DB_USER || 'root';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || '';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || process.env.DB_NAME || 'library';

export const sequelize = new Sequelize(MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD, {
  host: MYSQL_HOST,
  port: Number(MYSQL_PORT),
  dialect: 'mysql',
  logging: false, // set to console.log for debugging
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000
  },
  define: {
    underscored: false,
    timestamps: false
  }
});

export async function initSequelize() {
  try {
    await sequelize.authenticate();
    // No sync(): we assume existing legacy table structure managed outside ORM
    console.log('[sequelize] connection established');
  } catch (err) {
    console.error('[sequelize] connection error', err);
    throw err;
  }
}
