import { UniqueConstraintError, Transaction } from 'sequelize';
import { config } from '../../config';
import { getRedisClient } from '../../config/redis';
import { getQuota, initSubsidyRedis, RedisKeys, tryMarkApplied } from '../../lib/redis/queue';
import { Application, SubsidyProgram } from '../../models';
import { sequelize } from '../../config/database';
import { ApplicationStatus } from '../../models/Application';

export class AdminServiceError extends Error {
  constructor(
    public readonly code: 'QUOTA_EXHAUSTED' | 'ALREADY_APPLIED' | 'PROGRAM_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'AdminServiceError';
  }
}

export interface AdminApplicationInput {
  userId: string;
  name: string;
  phone: string;
  status?: ApplicationStatus;
}

export interface AdminApplicationItem {
  id: number;
  userId: string;
  name: string;
  phone: string;
  status: ApplicationStatus;
  createdAt: string;
}

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

/** 관리자 수동 신청 등록 — DB·Redis 쿼터 동기화 */
export async function createAdminApplication(
  input: AdminApplicationInput,
): Promise<{ applicationId: number }> {
  const programId = config.SUBSIDY_PROGRAM_ID;
  const status = input.status ?? 'success';

  const applicationId = await sequelize.transaction(async (transaction: Transaction) => {
    const program = await SubsidyProgram.findByPk(programId, {
      transaction,
      lock: Transaction.LOCK.UPDATE,
    });

    if (!program) {
      throw new AdminServiceError('PROGRAM_NOT_FOUND', 'Subsidy program not found');
    }

    if (program.remainingQuota <= 0) {
      throw new AdminServiceError('QUOTA_EXHAUSTED', 'Quota exhausted');
    }

    const existing = await Application.findOne({
      where: { programId, userId: input.userId },
      transaction,
    });

    if (existing) {
      throw new AdminServiceError('ALREADY_APPLIED', 'Already applied');
    }

    const application = await Application.create(
      {
        programId,
        userId: input.userId,
        name: input.name,
        phone: input.phone,
        status,
      },
      { transaction },
    );

    await program.decrement('remainingQuota', { by: 1, transaction });

    return Number(application.id);
  });

  const redis = getRedisClient();
  const quotaKey = RedisKeys.quota(programId);
  const currentQuota = await redis.get(quotaKey);
  if (currentQuota !== null) {
    const remaining = await redis.decr(quotaKey);
    if (remaining < 0) {
      await redis.incr(quotaKey);
    }
  }
  await tryMarkApplied(programId, input.userId);

  return { applicationId };
}

/** 신청 내역 전체 삭제 + 쿼터·Redis 초기화 */
export async function clearAllApplications(): Promise<void> {
  await resetLoadTestEnvironment();
}

export async function listRecentApplications(
  limit = 20,
): Promise<AdminApplicationItem[]> {
  const programId = config.SUBSIDY_PROGRAM_ID;
  const rows = await Application.findAll({
    where: { programId },
    order: [['id', 'DESC']],
    limit: Math.min(limit, 100),
  });

  return rows.map((row) => ({
    id: Number(row.id),
    userId: row.userId,
    name: row.name,
    phone: row.phone,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }));
}
