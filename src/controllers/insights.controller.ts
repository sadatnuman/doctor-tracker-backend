import type { Request, Response } from 'express';
import * as metaService from '../services/meta.service.js';
import * as statsService from '../services/stats.service.js';

export async function overview(req: Request, res: Response) {
  res.set('Cache-Control', 'private, max-age=30');
  res.json({ data: await statsService.getOverview(req.validated.query) });
}

export async function filters(_req: Request, res: Response) {
  res.set('Cache-Control', 'private, max-age=60');
  res.json({ data: await metaService.getFilterOptions() });
}
