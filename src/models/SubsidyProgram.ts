import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model,
} from 'sequelize';
import { sequelize } from '../config/database';

export class SubsidyProgram extends Model<
  InferAttributes<SubsidyProgram>,
  InferCreationAttributes<SubsidyProgram>
> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare totalQuota: number;
  declare remainingQuota: number;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

SubsidyProgram.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    totalQuota: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    remainingQuota: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: 'subsidy_programs',
    indexes: [{ unique: true, fields: ['name'] }],
  },
);
