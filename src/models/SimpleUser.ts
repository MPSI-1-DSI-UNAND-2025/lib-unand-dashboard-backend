import { DataTypes, Model, type Optional } from 'sequelize';
import { authSequelize } from '../db/authSequelize.js';

export interface UserAttributes {
  id: number;
  username: string;
  password_hash: string;
  access_token?: string | null;
  refresh_token?: string | null;
  token_expires_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface UserCreationAttributes extends Optional<UserAttributes, 'id' | 'created_at' | 'updated_at' | 'access_token' | 'refresh_token' | 'token_expires_at'> {}

// Use 'declare' to avoid shadowing Sequelize's internal getters/setters
export class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
  declare id: number;
  declare username: string;
  declare password_hash: string;
  declare access_token: string | null;
  declare refresh_token: string | null;
  declare token_expires_at: Date | null;
  declare created_at: Date;
  declare updated_at: Date;
}

// Initialize simple model
User.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    username: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true
    },
    password_hash: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    access_token: { type: DataTypes.TEXT, allowNull: true },
    refresh_token: { type: DataTypes.TEXT, allowNull: true },
    token_expires_at: { type: DataTypes.DATE, allowNull: true },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  },
  {
    sequelize: authSequelize,
    tableName: 'users',
    // Use our own timestamp columns; keep timestamps false to avoid sequelize adding extra columns
    timestamps: false
  }
);

export default User;