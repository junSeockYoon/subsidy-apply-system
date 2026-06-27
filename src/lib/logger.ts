import pino from 'pino';
import { config } from '../config';

/**
 * pino 구조화 로거
 *
 * 성능 이점:
 * - console.log 대비 비동기·저오버헤드 → 고트래픽 시 I/O 병목 완화
 * - JSON 로그는 이후 ELK/Datadog 등으로 파싱·집계하기 쉽습니다.
 */
export const logger = pino({
  level: config.NODE_ENV === 'production' ? 'info' : 'debug',
});
