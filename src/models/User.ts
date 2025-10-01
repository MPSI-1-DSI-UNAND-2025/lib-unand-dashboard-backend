import { DataTypes, Model, type Optional } from 'sequelize';
import { authSequelize } from '../db/authSequelize.js';

// Interface untuk User attributes
export interface UserAttributes {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  full_name?: string;
  role: 'admin' | 'librarian' | 'viewer';
  is_active: boolean;
  last_login?: Date;
  created_at: Date;
  updated_at: Date;
}

// Interface untuk User creation (id, created_at, updated_at optional)
export interface UserCreationAttributes extends Optional<UserAttributes, 'id' | 'created_at' | 'updated_at' | 'full_name' | 'last_login'> {}

// Model class
export class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
  public id!: number;
  public username!: string;
  public email!: string;
  public password_hash!: string;
  public full_name?: string;
  public role!: 'admin' | 'librarian' | 'viewer';
  public is_active!: boolean;
  public last_login?: Date;
  public created_at!: Date;
  public updated_at!: Date;
}

// Initialize model
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
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true
      }
    },
    password_hash: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    full_name: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    role: {
      type: DataTypes.ENUM('admin', 'librarian', 'viewer'),
      defaultValue: 'viewer'
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    last_login: {
      type: DataTypes.DATE,
      allowNull: true
    },
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
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['username']
      },
      {
        fields: ['email']
      },
      {
        fields: ['role']
      }
    ]
  }
);

export default User;