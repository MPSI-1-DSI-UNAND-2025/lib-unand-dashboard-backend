import { DataTypes, Model, type Optional } from 'sequelize';
import { authSequelize } from '../db/authSequelize.js';

export interface EventAttributes {
  id: number;
  title: string;
  location: string;
  starts_at: Date;          // waktu mulai event
  thumbnail_path: string | null; // relative path file
  created_at: Date;
  updated_at: Date;
}

export interface EventCreationAttributes extends Optional<EventAttributes, 'id' | 'thumbnail_path' | 'created_at' | 'updated_at'> {}

export class Event extends Model<EventAttributes, EventCreationAttributes> implements EventAttributes {
  declare id: number;
  declare title: string;
  declare location: string;
  declare starts_at: Date;
  declare thumbnail_path: string | null;
  declare created_at: Date;
  declare updated_at: Date;
}

Event.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    title: { type: DataTypes.STRING(200), allowNull: false },
    location: { type: DataTypes.STRING(255), allowNull: false },
    starts_at: { type: DataTypes.DATE, allowNull: false },
    thumbnail_path: { type: DataTypes.STRING(255), allowNull: true },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  },
  {
    sequelize: authSequelize,
    tableName: 'events',
    timestamps: false,
    indexes: [
      { fields: ['starts_at'] }
    ]
  }
);

export default Event;