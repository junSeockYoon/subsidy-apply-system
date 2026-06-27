import { ConnectionOptions } from 'bullmq';
import { config } from './index';

export const EXPORT_QUEUE_NAME = 'export';

/**
 * BullMQ 전용 Redis 연결 옵션
 *
 * 성능 이점:
 * - API의 ioredis 싱글톤과 분리해 블로킹 명령이 서로 간섭하지 않음
 * - maxRetriesPerRequest: null — BullMQ 필수 설정 (재시도 무한)
 */
export function getBullmqConnection(): ConnectionOptions {
  return {
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  };
}
