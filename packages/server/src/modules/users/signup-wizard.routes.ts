/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Public first-open email subscriber wizard (no login required).
 * Mounted before authGuard so it still appears when AUTH_REQUIRED=true.
 */
import { Router, Request, Response } from 'express';
import { AppSettingsStore } from '../admin/app-settings.service';
import { SignupModule } from './signup-wizard.service';
import { rateLimit } from '../../platform/guards/rate-limit';

export function createSignupRoutes(
  signupModule = new SignupModule(new AppSettingsStore())
): Router {
  const router = Router();

  // Cap per IP: legit use is one or two calls (submit / retry / skip).
  const signupLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

  router.get('/state', async (_req: Request, res: Response) => {
    res.json(await signupModule.getState());
  });

  router.post('/', signupLimiter, async (req: Request, res: Response) => {
    const { email, source } = req.body as { email?: string; source?: string };
    if (!email) {
      res.status(400).json({ ok: false, error: 'Email is required.' });
      return;
    }
    const src = source === 'cli' ? 'cli' : 'web';
    res.json(await signupModule.submit(email, src));
  });

  router.post('/skip', signupLimiter, async (_req: Request, res: Response) => {
    await signupModule.skip();
    res.json({ ok: true });
  });

  return router;
}
