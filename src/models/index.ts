import { Application } from './Application';
import { SubsidyProgram } from './SubsidyProgram';

SubsidyProgram.hasMany(Application, {
  foreignKey: 'programId',
  as: 'applications',
});

Application.belongsTo(SubsidyProgram, {
  foreignKey: 'programId',
  as: 'program',
});

export { Application, SubsidyProgram };

export async function syncModels(): Promise<void> {
  await SubsidyProgram.sync();
  await Application.sync();
}
