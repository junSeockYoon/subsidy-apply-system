import { Application, SubsidyProgram } from '../../models';
import { ApplyInput, ApplyResult } from './types';

/**
 * DB 직행 선착순 신청 (비교용 안티패턴 API)
 *
 * 의도적으로 취약한 설계:
 * - 트랜잭션·행 잠금 없이 READ → INSERT → UPDATE
 * - 중복 검사도 DB SELECT에만 의존 (Redis 미사용)
 * - 동시 요청 시 remainingQuota 음수·초과 신청 가능 (race condition)
 *
 * Step 5 k6 부하 테스트에서 good API와 성능·정합성 차이를 입증합니다.
 */
export async function applyBad(
  input: ApplyInput,
  programId: number,
): Promise<ApplyResult> {
  const program = await SubsidyProgram.findByPk(programId);
  if (!program) {
    return { outcome: 'failed', reason: 'PROGRAM_NOT_FOUND' };
  }

  const existing = await Application.findOne({
    where: { programId, userId: input.userId },
  });
  if (existing) {
    return { outcome: 'failed', reason: 'ALREADY_APPLIED' };
  }

  // race condition 구간: 여러 요청이 동시에 remainingQuota > 0을 읽을 수 있음
  if (program.remainingQuota <= 0) {
    return { outcome: 'failed', reason: 'QUOTA_EXHAUSTED' };
  }

  const application = await Application.create({
    programId,
    userId: input.userId,
    name: input.name,
    phone: input.phone,
    status: 'success',
  });

  await program.decrement('remainingQuota');

  return { outcome: 'success', applicationId: Number(application.id) };
}
