import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

// Use MYSQL2_* variables for auth database
const MYSQL2_HOST = process.env.MYSQL2_HOST || '127.0.0.1';
const MYSQL2_PORT = process.env.MYSQL2_PORT || '3306';
const MYSQL2_USER = process.env.MYSQL2_USER || 'admin';
const MYSQL2_PASSWORD = process.env.MYSQL2_PASSWORD || 'admin';
const MYSQL2_DATABASE = process.env.MYSQL2_DATABASE || 'libdashboard';

export const authSequelize = new Sequelize(MYSQL2_DATABASE, MYSQL2_USER, MYSQL2_PASSWORD, {
  host: MYSQL2_HOST,
  port: Number(MYSQL2_PORT),
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

export async function initAuthSequelize() {
  try {
    await authSequelize.authenticate();
    // Sync models for auth database
    await authSequelize.sync({ alter: false }); // set to true if you want to auto-update schema
    console.log('[authSequelize] connection established for auth database');
  } catch (err) {
    console.error('[authSequelize] connection error', err);
    throw err;
  }
}

// For backward compatibility, export the original sequelize as well
export { sequelize } from './sequelize.js';