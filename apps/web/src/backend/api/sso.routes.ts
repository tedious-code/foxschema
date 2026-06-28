import { Router, Request, Response } from 'express';
import { AuthModule } from '../modules/auth.module';
import { newToken } from '../cores/crypto';
import { readCookie, setSessionCookie } from './auth.routes';
import { authorizeUrl, configuredProviders, fetchVerifiedEmail, getProvider, redirectUri } from '../modules/sso.module';

const STATE_COOKIE = 'sso_state';
const STATE_PATH = '/api/auth/sso';

/** SSO (OAuth2/OIDC) routes — mounted at /api/auth/sso. */
export function createSsoRoutes(auth: AuthModule): Router {
  const router = Router();
  const secure = process.env.NODE_ENV === 'production';

  // Which providers are configured (drives which buttons the login shows).
  router.get('/providers', (_req: Request, res: Response) => {
    res.json({ providers: configuredProviders().map((p) => ({ id: p.id, label: p.label })) });
  });

  // Begin the flow: set a CSRF state cookie and redirect to the provider.
  router.get('/:provider/start', (req: Request, res: Response) => {
    const provider = getProvider(String(req.params.provider));
    if (!provider) {
      res.status(404).send('Unknown or unconfigured SSO provider');
      return;
    }
    const state = newToken();
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: 10 * 60 * 1000,
      path: STATE_PATH,
    });
    res.redirect(authorizeUrl(provider, redirectUri(req, provider.id), state));
  });

  // Provider redirects back here with ?code&state.
  router.get('/:provider/callback', async (req: Request, res: Response) => {
    try {
      const provider = getProvider(String(req.params.provider));
      if (!provider) throw new Error('Unknown SSO provider');

      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const expected = readCookie(req, STATE_COOKIE);
      if (!code || !state || !expected || state !== expected) throw new Error('Invalid or expired SSO state');
      res.clearCookie(STATE_COOKIE, { path: STATE_PATH });

      const email = await fetchVerifiedEmail(provider, code, redirectUri(req, provider.id));
      const { token } = await auth.loginWithEmail(email);
      setSessionCookie(res, token);
      res.redirect('/');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'SSO sign-in failed';
      res.redirect('/?sso_error=' + encodeURIComponent(message));
    }
  });

  return router;
}
