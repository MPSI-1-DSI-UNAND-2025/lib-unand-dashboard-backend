import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

const {
  DB_HOST = 'localhost',
  DB_PORT = '3306',
  DB_USER = 'root',
  DB_PASSWORD = '',
  DB_NAME = 'library'
} = process.env;

export const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
  host: DB_HOST,
  port: Number(DB_PORT),
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
