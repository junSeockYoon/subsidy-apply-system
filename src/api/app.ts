import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { logger } from '../lib/logger';
import routes from './routes';
import { errorHandler } from './middlewares/errorHandler';

/**
 * Express 앱 조립
 *
 * 성능·안정성 포인트:
 * - helmet: 기본 보안 헤더로 불필요한 공격 벡터 차단
 * - pino-http: 요청별 구조화 로그 (고트래픽에서도 저비용)
 * - json limit: 과도하게 큰 body로 이벤트 루프 점유 방지
 */
export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: '1mb' }));

  app.use(routes);
  app.use(errorHandler);

  return app;
}
