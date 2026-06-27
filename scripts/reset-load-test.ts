import { connectDatabase, closeDatabase, sequelize } from '../src/config/database';
import { connectRedis, closeRedis, getRedisClient } from '../src/config/redis';
import { initSubsidyRedis } from '../src/lib/redis/queue';
import { SubsidyProgram } from '../src/models';
import { config } from '../src/config';

/**
 * 부하 테스트 전 데이터 초기화
 * - applications 테이블 비우기
 * - remaining_quota 10,000으로 복원
 * - Redis subsidy:* 키 삭제 후 카운터 재설정
 */
async function resetLoadTest(): Promise<void> {
  await connectDatabase();
  await connectRedis();

  const programId = config.SUBSIDY_PROGRAM_ID;
  const quota = config.SUBSIDY_TOTAL_QUOTA;

  console.log('Truncating applications...');
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
  await sequelize.query('TRUNCATE TABLE applications');
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');

  console.log(`Resetting remaining_quota to ${quota}...`);
  await SubsidyProgram.update({ remainingQuota: quota }, { where: { id: programId } });

  const redis = getRedisClient();
  const keys = await redis.keys('subsidy:*');
  if (keys.length > 0) {
    console.log(`Deleting ${keys.length} Redis keys (subsidy:*)...`);
    await redis.del(...keys);
  }

  await initSubsidyRedis(programId, quota);
  console.log('Load test environment reset complete.');

  await closeDatabase();
  await closeRedis();
}

resetLoadTest().catch((error) => {
  console.error('Reset failed:', error);
  process.exit(1);
});
