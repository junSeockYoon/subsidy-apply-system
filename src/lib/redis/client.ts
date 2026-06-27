/**
 * config/redis의 싱글톤을 lib 레이어에서 재export합니다.
 * Redis 관련 유틸(redlock, queue)이 동일 커넥션을 공유하도록 합니다.
 */
export { getRedisClient } from '../../config/redis';
