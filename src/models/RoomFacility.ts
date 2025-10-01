import { DataTypes, Model } from 'sequelize';
import type { Optional } from 'sequelize';
import { authSequelize } from '../db/authSequelize.js';

export interface RoomFacilityAttributes {
  id: number;
  name: string;
  description: string | null;
  photo_path: string | null; // relative path to uploaded image
  created_at: Date;
  updated_at: Date;
}

export interface RoomFacilityCreationAttributes extends Optional<RoomFacilityAttributes, 'id' | 'description' | 'photo_path' | 'created_at' | 'updated_at'> {}

export class RoomFacility extends Model<RoomFacilityAttributes, RoomFacilityCreationAttributes> implements RoomFacilityAttributes {
  declare id: number;
  declare name: string;
  declare description: string | null;
  declare photo_path: string | null;
  declare created_at: Date;
  declare updated_at: Date;
}

RoomFacility.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(200), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    photo_path: { type: DataTypes.STRING(255), allowNull: true },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  },
  {
    sequelize: authSequelize,
    tableName: 'room_facilities',
    timestamps: false,
    indexes: [ { fields: ['name'] } ]
  }
);

export default RoomFacility;
