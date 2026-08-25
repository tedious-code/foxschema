import { Router } from '../../platform/http/router';
import type { HttpResponse } from '../../platform/http/types';
import { UserModule, UserPreferences } from './user.service';
import { AuthedRequest } from '../auth/auth.routes';

/** The signed-in user's preferences / onboarding state. */
export function createUserRoutes(user: UserModule): Router {
  const router = Router();

  router.get('/preferences', async (req: AuthedRequest, res: HttpResponse) => {
    res.json({ preferences: await user.getPreferences(req.userId!) });
  });

  router.put('/preferences', async (req: AuthedRequest, res: HttpResponse) => {
    const { role, primaryDatabase, primaryGoal, theme, onboardingCompleted } = req.body as Partial<UserPreferences>;
    res.json({
      preferences: await user.updatePreferences(req.userId!, {
        role,
        primaryDatabase,
        primaryGoal,
        theme,
        onboardingCompleted,
      }),
    });
  });

  return router;
}
