import { getRedisClient } from './client';

/** 동시에 DB까지 진입할 수 있는 최대 요청 수 — 초과 시 즉시 거절(대기열 효과) */
const MAX_CONCURRENT_APPLY = 50;

export const RedisKeys = {
  quota: (programId: number) => `subsidy:quota:${programId}`,
  applied: (programId: number, userId: string) => `subsidy:applied:${programId}:${userId}`,
  concurrent: (programId: number) => `subsidy:concurrent:${programId}`,
  queue: (programId: number) => `subsidy:queue:${programId}`,
};

/**
 * 서버 기동 시 Redis 잔여 수량 초기화 (SET NX)
 * 성능 이점: 재시작해도 기존 카운터를 덮어쓰지 않아 부하 테스트 중 정합성 유지
 */
export async function initSubsidyRedis(
  programId: number,
  remainingQuota: number,
): Promise<void> {
  const redis = getRedisClient();
  await redis.set(RedisKeys.quota(programId), remainingQuota, 'NX');
}

export async function getQuota(programId: number): Promise<number> {
  const value = await getRedisClient().get(RedisKeys.quota(programId));
  return value ? Number(value) : 0;
}

/**
 * 원자적 잔여 수량 차감 (DECR)
 * 0 미만이 되면 INCR로 롤백 후 false 반환
 */
export async function tryDecrementQuota(programId: number): Promise<boolean> {
  const redis = getRedisClient();
  const remaining = await redis.decr(RedisKeys.quota(programId));

  if (remaining < 0) {
    await redis.incr(RedisKeys.quota(programId));
    return false;
  }

  return true;
}

export async function rollbackQuota(programId: number): Promise<void> {
  await getRedisClient().incr(RedisKeys.quota(programId));
}

/** SET NX — 중복 신청을 Redis에서 μs 단위로 차단 (DB 조회 생략) */
export async function tryMarkApplied(
  programId: number,
  userId: string,
): Promise<boolean> {
  const result = await getRedisClient().set(
    RedisKeys.applied(programId, userId),
    '1',
    'NX',
  );
  return result === 'OK';
}

export async function isAlreadyApplied(
  programId: number,
  userId: string,
): Promise<boolean> {
  const exists = await getRedisClient().exists(
    RedisKeys.applied(programId, userId),
  );
  return exists === 1;
}

/**
 * 동시 처리 슬롯 (세마포어)
 * 성능 이점: 10만 동시 요청이 한꺼번에 DB 커넥션 풀을 고갈시키는 것을 방지
 */
export async function acquireConcurrencySlot(programId: number): Promise<boolean> {
  const redis = getRedisClient();
  const current = await redis.incr(RedisKeys.concurrent(programId));

  if (current > MAX_CONCURRENT_APPLY) {
    await redis.decr(RedisKeys.concurrent(programId));
    return false;
  }

  return true;
}

export async function releaseConcurrencySlot(programId: number): Promise<void> {
  await getRedisClient().decr(RedisKeys.concurrent(programId));
}

/**
 * 대기열 등록 (LPUSH) — 요청 순서 추적
 * 성능 이점: 마감 후 유입 요청을 DB 도달 전 Redis에서 빠르게 식별
 */
export async function enqueueRequest(
  programId: number,
  requestId: string,
): Promise<void> {
  await getRedisClient().lpush(RedisKeys.queue(programId), requestId);
}
