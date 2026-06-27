import Redis from 'ioredis';
import { config } from './index';

let redisClient: Redis | null = null;

/**
 * ioredis 싱글톤
 *
 * 성능 이점:
 * - 프로세스당 Redis 연결 1개만 유지 → 커넥션 수 폭증 방지
 * - BullMQ·Redlock·대기열이 동일 클라이언트를 공유해 리소스를 절약합니다.
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host: config.REDIS_HOST,
      port: config.REDIS_PORT,
      password: config.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null, // BullMQ 사용 시 필수 설정
      lazyConnect: true,
    });
  }

  return redisClient;
}

export async function connectRedis(): Promise<void> {
  await getRedisClient().ping();
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

export async function pingRedis(): Promise<string> {
  return getRedisClient().ping();
}
