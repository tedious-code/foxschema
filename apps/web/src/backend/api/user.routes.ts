import { Router, Response } from 'express';
import { UserModule, UserPreferences } from '../modules/user.module';
import { AuthedRequest } from './auth.routes';

/** The signed-in user's preferences / onboarding state. */
export function createUserRoutes(user: UserModule): Router {
  const router = Router();

  router.get('/preferences', async (req: AuthedRequest, res: Response) => {
    res.json({ preferences: await user.getPreferences(req.userId!) });
  });

  router.put('/preferences', async (req: AuthedRequest, res: Response) => {
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
