import { config } from '../src/config';
import { connectDatabase, closeDatabase } from '../src/config/database';
import { Application, SubsidyProgram } from '../src/models';

const BATCH_SIZE = 2000;
const DEFAULT_COUNT = 100_000;

/**
 * 대용량 더미 신청 데이터 시드
 *
 * 사용법:
 *   npm run seed           # 10만 건
 *   npm run seed -- 50000  # 5만 건
 *
 * bulkCreate 배치 삽입으로 수십만 건도 빠르게 적재합니다.
 */
async function seed(): Promise<void> {
  const count = Number(process.argv[2]) || DEFAULT_COUNT;
  const programId = config.SUBSIDY_PROGRAM_ID;

  await connectDatabase();

  const program = await SubsidyProgram.findByPk(programId);
  if (!program) {
    throw new Error(`Subsidy program ${programId} not found. Run API server first.`);
  }

  console.log(`Seeding ${count.toLocaleString()} applications for program ${programId}...`);

  const start = Date.now();

  for (let offset = 0; offset < count; offset += BATCH_SIZE) {
    const batchCount = Math.min(BATCH_SIZE, count - offset);
    const records = Array.from({ length: batchCount }, (_, i) => {
      const seq = offset + i + 1;
      return {
        programId,
        userId: `seed-user-${String(seq).padStart(8, '0')}`,
        name: `테스트${seq}`,
        phone: `010${String(10000000 + (seq % 90000000)).slice(-8)}`,
        status: 'success' as const,
      };
    });

    await Application.bulkCreate(records, { ignoreDuplicates: true });
    console.log(`  ${Math.min(offset + batchCount, count).toLocaleString()} / ${count.toLocaleString()}`);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const total = await Application.count({ where: { programId } });
  console.log(`Done in ${elapsed}s. Total applications: ${total.toLocaleString()}`);

  await closeDatabase();
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
