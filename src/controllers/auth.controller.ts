import type { Request, Response } from 'express';
import { AUTH_COOKIE } from '../config/constants.js';
import * as authService from '../services/auth.service.js';

export async function login(req: Request, res: Response) {
  const { email, password } = req.validated.body;
  const { user, token } = await authService.login(email, password);
  res.cookie(AUTH_COOKIE, token, authService.authCookieOptions(token));
  // The token is also returned for non-browser API clients (Bearer auth).
  res.json({ data: { user, token } });
}

export function logout(_req: Request, res: Response) {
  res.clearCookie(AUTH_COOKIE, authService.baseCookieOptions());
  res.status(204).end();
}

export async function me(req: Request, res: Response) {
  res.json({ data: await authService.getUserById(req.user!.id) });
}
