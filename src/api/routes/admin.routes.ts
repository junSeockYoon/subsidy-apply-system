import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  getAdminStats,
  resetLoadTestEnvironment,
  seedApplications,
} from '../../services/admin/admin.service';

const router = Router();

router.get('/api/admin/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await getAdminStats();
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

router.post('/api/admin/reset', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await resetLoadTestEnvironment();
    const stats = await getAdminStats();
    res.json({ message: 'Reset complete', stats });
  } catch (error) {
    next(error);
  }
});

const seedSchema = z.object({
  count: z.coerce.number().int().positive().max(50_000),
});

router.post('/api/admin/seed', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { count } = seedSchema.parse(req.body);
    const result = await seedApplications(count);
    const stats = await getAdminStats();
    res.json({ message: `Seeded ${result.inserted} applications`, stats });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'VALIDATION_ERROR', details: error.flatten() });
      return;
    }
    next(error);
  }
});

export default router;
