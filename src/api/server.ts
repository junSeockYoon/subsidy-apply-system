import { createApp } from './app';
import { config } from '../config';
import { connectDatabase, closeDatabase } from '../config/database';
import { connectRedis, closeRedis } from '../config/redis';
import { SubsidyProgram, syncModels } from '../models';
import { initSubsidyRedis } from '../lib/redis/queue';
import { logger } from '../lib/logger';

async function ensureDefaultProgram(): Promise<void> {
  const [program] = await SubsidyProgram.findOrCreate({
    where: { name: '대국민 금융 지원금' },
    defaults: {
      name: '대국민 금융 지원금',
      totalQuota: config.SUBSIDY_TOTAL_QUOTA,
      remainingQuota: config.SUBSIDY_TOTAL_QUOTA,
    },
  });

  logger.info(
    { programId: program.id, remainingQuota: program.remainingQuota },
    'Subsidy program ready',
  );

  await initSubsidyRedis(program.id, program.remainingQuota);
}

async function bootstrap(): Promise<void> {
  await connectDatabase();
  await connectRedis();
  await syncModels();
  await ensureDefaultProgram();

  const app = createApp();
  const server = app.listen(config.API_PORT, () => {
    logger.info({ port: config.API_PORT }, 'API server started');
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down API server');

    server.close(async () => {
      await closeDatabase();
      await closeRedis();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((error) => {
  logger.error({ err: error }, 'Failed to start API server');
  process.exit(1);
});
