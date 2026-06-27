import { Router, Request, Response } from 'express';
import { sequelize } from '../../config/database';
import { pingRedis } from '../../config/redis';

const router = Router();

/**
 * 헬스체크 — DB·Redis 연결 상태를 한 번에 확인
 * PM2/Docker 재시작 판단 및 로드밸런서 probe에 활용
 */
router.get('/health', async (_req: Request, res: Response) => {
  try {
    await sequelize.authenticate();
    const redisPong = await pingRedis();

    res.json({
      status: 'ok',
      mysql: 'connected',
      redis: redisPong === 'PONG' ? 'connected' : 'unknown',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Service unavailable',
    });
  }
});

export default router;
