import { UniqueConstraintError } from 'sequelize';
import { Application, SubsidyProgram } from '../../models';
import { getRedlock, lockResource } from '../../lib/redis/redlock';
import {
  acquireConcurrencySlot,
  enqueueRequest,
  getQuota,
  isAlreadyApplied,
  releaseConcurrencySlot,
  rollbackQuota,
  tryDecrementQuota,
  tryMarkApplied,
} from '../../lib/redis/queue';
import { ApplyInput, ApplyResult } from './types';
import { v4 as uuidv4 } from 'uuid';

const LOCK_TTL_MS = 3000;

/**
 * Redis + Redlock 선착순 신청 (권장 API)
 *
 * 처리 순서:
 * 1. 동시 처리 슬롯 획득 (DB 보호)
 * 2. Redis 잔여 수량 fast-fail (마감 시 DB 미접근)
 * 3. Redis 중복 검사 (DB SELECT 생략)
 * 4. Redlock 하에서 차감 → 중복 마킹 → DB INSERT
 */
export async function applyGood(
  input: ApplyInput,
  programId: number,
): Promise<ApplyResult> {
  const slotAcquired = await acquireConcurrencySlot(programId);
  if (!slotAcquired) {
    return { outcome: 'failed', reason: 'TOO_BUSY' };
  }

  try {
    await enqueueRequest(programId, uuidv4());

    if ((await getQuota(programId)) <= 0) {
      return { outcome: 'failed', reason: 'QUOTA_EXHAUSTED' };
    }

    if (await isAlreadyApplied(programId, input.userId)) {
      return { outcome: 'failed', reason: 'ALREADY_APPLIED' };
    }

    const redlock = getRedlock();

    return await redlock.using([lockResource(programId)], LOCK_TTL_MS, async (signal) => {
      if (signal.aborted) {
        throw signal.error;
      }

      if (await isAlreadyApplied(programId, input.userId)) {
        return { outcome: 'failed', reason: 'ALREADY_APPLIED' } as ApplyResult;
      }

      const decremented = await tryDecrementQuota(programId);
      if (!decremented) {
        return { outcome: 'failed', reason: 'QUOTA_EXHAUSTED' } as ApplyResult;
      }

      const marked = await tryMarkApplied(programId, input.userId);
      if (!marked) {
        await rollbackQuota(programId);
        return { outcome: 'failed', reason: 'ALREADY_APPLIED' } as ApplyResult;
      }

      try {
        const application = await Application.create({
          programId,
          userId: input.userId,
          name: input.name,
          phone: input.phone,
          status: 'success',
        });

        await SubsidyProgram.decrement('remainingQuota', {
          where: { id: programId },
        });

        return { outcome: 'success', applicationId: Number(application.id) };
      } catch (error) {
        await rollbackQuota(programId);
        if (error instanceof UniqueConstraintError) {
          return { outcome: 'failed', reason: 'ALREADY_APPLIED' };
        }
        throw error;
      }
    });
  } finally {
    await releaseConcurrencySlot(programId);
  }
}
