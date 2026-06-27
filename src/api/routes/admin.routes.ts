import { Router, Request, Response, NextFunction } from 'express';
import { UniqueConstraintError } from 'sequelize';
import { z } from 'zod';
import {
  AdminServiceError,
  clearAllApplications,
  createAdminApplication,
  getAdminStats,
  listRecentApplications,
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

router.get('/api/admin/applications', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const applications = await listRecentApplications(limit);
    res.json({ applications });
  } catch (error) {
    next(error);
  }
});

const applicationSchema = z.object({
  userId: z.string().min(1).max(64),
  name: z.string().min(1).max(50),
  phone: z.string().regex(/^[0-9-]{10,20}$/),
  status: z.enum(['success', 'failed', 'pending']).optional(),
});

router.post('/api/admin/applications', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = applicationSchema.parse(req.body);
    const result = await createAdminApplication(body);
    const stats = await getAdminStats();
    res.status(201).json({
      message: 'Application created',
      applicationId: result.applicationId,
      stats,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        status: 'failed',
        reason: 'VALIDATION_ERROR',
        details: error.flatten().fieldErrors,
      });
      return;
    }
    if (error instanceof AdminServiceError) {
      res.status(409).json({ status: 'failed', reason: error.code });
      return;
    }
    if (error instanceof UniqueConstraintError) {
      res.status(409).json({ status: 'failed', reason: 'ALREADY_APPLIED' });
      return;
    }
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

router.post('/api/admin/clear', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await clearAllApplications();
    const stats = await getAdminStats();
    res.json({
      message: 'All applications cleared and quota restored',
      stats,
    });
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
