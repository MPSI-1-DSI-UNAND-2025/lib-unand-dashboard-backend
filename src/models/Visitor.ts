import { DataTypes, Model } from 'sequelize';
import type { Optional } from 'sequelize';
import { sequelize } from '../db/sequelize.js';

interface VisitorAttributes {
  visitor_id: number;
  member_id: string | null;
  member_name: string | null;
  institution: string | null;
  room_code: string | null;
  checkin_date: Date; // store as Date
}

// Creation attributes (PK is auto increment)
interface VisitorCreationAttributes extends Optional<VisitorAttributes, 'visitor_id'> {}

export class Visitor extends Model<VisitorAttributes, VisitorCreationAttributes> implements VisitorAttributes {
  declare visitor_id: number;
  declare member_id: string | null;
  declare member_name: string | null;
  declare institution: string | null;
  declare room_code: string | null;
  declare checkin_date: Date;
}

Visitor.init({
  visitor_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    autoIncrement: true,
    primaryKey: true
  },
  member_id: {
    type: DataTypes.STRING(64),
    allowNull: true
  },
  member_name: {
    type: DataTypes.STRING(128),
    allowNull: true
  },
  institution: {
    type: DataTypes.STRING(128),
    allowNull: true
  },
  room_code: {
    type: DataTypes.STRING(64),
    allowNull: true
  },
  checkin_date: {
    type: DataTypes.DATE,
    allowNull: false
  }
}, {
  sequelize,
  tableName: 'visitor_count', // legacy table name
  timestamps: false
});
