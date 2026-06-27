import { config } from '../../config';
import { getRedisClient } from '../../config/redis';
import { getQuota, initSubsidyRedis, RedisKeys } from '../../lib/redis/queue';
import { Application, SubsidyProgram } from '../../models';
import { sequelize } from '../../config/database';

export interface AdminStats {
  program: {
    id: number;
    name: string;
    totalQuota: number;
    remainingQuota: number;
  };
  applicationCount: number;
  successCount: number;
  redisQuota: number;
}

export async function getAdminStats(): Promise<AdminStats> {
  const programId = config.SUBSIDY_PROGRAM_ID;
  const program = await SubsidyProgram.findByPk(programId);

  if (!program) {
    throw new Error('Subsidy program not found');
  }

  const [applicationCount, successCount] = await Promise.all([
    Application.count({ where: { programId } }),
    Application.count({ where: { programId, status: 'success' } }),
  ]);

  const redisQuota = await getQuota(programId);

  return {
    program: {
      id: program.id,
      name: program.name,
      totalQuota: program.totalQuota,
      remainingQuota: program.remainingQuota,
    },
    applicationCount,
    successCount,
    redisQuota,
  };
}

export async function resetLoadTestEnvironment(): Promise<void> {
  const programId = config.SUBSIDY_PROGRAM_ID;
  const quota = config.SUBSIDY_TOTAL_QUOTA;

  await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
  await sequelize.query('TRUNCATE TABLE applications');
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');

  await SubsidyProgram.update({ remainingQuota: quota }, { where: { id: programId } });

  const redis = getRedisClient();
  const keys = await redis.keys('subsidy:*');
  if (keys.length > 0) {
    await redis.del(...keys);
  }

  await redis.set(RedisKeys.quota(programId), quota);
  await initSubsidyRedis(programId, quota);
}

const BATCH_SIZE = 2000;
const MAX_SEED_COUNT = 50_000;

export async function seedApplications(count: number): Promise<{ inserted: number }> {
  const safeCount = Math.min(Math.max(count, 1), MAX_SEED_COUNT);
  const programId = config.SUBSIDY_PROGRAM_ID;

  const program = await SubsidyProgram.findByPk(programId);
  if (!program) {
    throw new Error('Subsidy program not found');
  }

  for (let offset = 0; offset < safeCount; offset += BATCH_SIZE) {
    const batchCount = Math.min(BATCH_SIZE, safeCount - offset);
    const records = Array.from({ length: batchCount }, (_, i) => {
      const seq = offset + i + 1;
      return {
        programId,
        userId: `seed-user-${String(seq).padStart(8, '0')}`,
        name: `테스트${seq}`,
        phone: `010${String(10000000 + (seq % 90000000)).slice(-8)}`,
        status: 'success' as const,
      };
    });

    await Application.bulkCreate(records, { ignoreDuplicates: true });
  }

  return { inserted: safeCount };
}
