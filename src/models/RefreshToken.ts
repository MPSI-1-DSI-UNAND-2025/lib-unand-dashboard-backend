import { DataTypes, Model, type Optional } from 'sequelize';
import { authSequelize } from '../db/authSequelize.js';

// Interface untuk RefreshToken attributes
export interface RefreshTokenAttributes {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: Date;
  created_at: Date;
  is_revoked: boolean;
}

// Interface untuk RefreshToken creation
export interface RefreshTokenCreationAttributes extends Optional<RefreshTokenAttributes, 'id' | 'created_at' | 'is_revoked'> {}

// Model class
export class RefreshToken extends Model<RefreshTokenAttributes, RefreshTokenCreationAttributes> implements RefreshTokenAttributes {
  public id!: number;
  public user_id!: number;
  public token_hash!: string;
  public expires_at!: Date;
  public created_at!: Date;
  public is_revoked!: boolean;
}

// Initialize model
RefreshToken.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    token_hash: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    is_revoked: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    }
  },
  {
    sequelize: authSequelize,
    tableName: 'refresh_tokens',
    timestamps: false,
    indexes: [
      {
        fields: ['user_id']
      },
      {
        fields: ['token_hash']
      },
      {
        fields: ['expires_at']
      }
    ]
  }
);

export default RefreshToken;