import { connectDatabase, closeDatabase } from '../src/config/database';
import { connectRedis, closeRedis } from '../src/config/redis';
import { resetLoadTestEnvironment } from '../src/services/admin/admin.service';

async function resetLoadTest(): Promise<void> {
  await connectDatabase();
  await connectRedis();
  await resetLoadTestEnvironment();
  console.log('Load test environment reset complete.');
  await closeDatabase();
  await closeRedis();
}

resetLoadTest().catch((error) => {
  console.error('Reset failed:', error);
  process.exit(1);
});
