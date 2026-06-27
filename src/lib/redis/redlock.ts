import Redlock from 'redlock';
import { getRedisClient } from './client';

let redlockInstance: Redlock | null = null;

/**
 * Redlock 분산 락
 *
 * 성능·정합성 이점:
 * - 잔여 수량 차감 + 중복 검사 + DB INSERT를 원자적으로 묶어 race condition 방지
 * - 단일 Redis 환경에서도 lock TTL로 데드락 자동 해소
 */
export function getRedlock(): Redlock {
  if (!redlockInstance) {
    redlockInstance = new Redlock([getRedisClient()], {
      retryCount: 5,
      retryDelay: 50,
      retryJitter: 50,
    });
  }

  return redlockInstance;
}

export function lockResource(programId: number): string {
  return `subsidy:lock:${programId}`;
}
