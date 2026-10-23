import type { Request, Response } from 'express';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../config/constants.js';
import * as authService from '../services/auth.service.js';

const meta = (req: Request): authService.RequestMeta => ({ userAgent: req.get('user-agent'), ip: req.ip });

function setSessionCookies(res: Response, session: authService.Session) {
  const base = authService.baseCookieOptions();
  res.cookie(ACCESS_COOKIE, session.accessToken, { ...base, maxAge: session.accessMaxAge });
  res.cookie(REFRESH_COOKIE, session.refreshToken, { ...base, maxAge: session.refreshMaxAge });
}

function clearSessionCookies(res: Response) {
  const base = authService.baseCookieOptions();
  res.clearCookie(ACCESS_COOKIE, base);
  res.clearCookie(REFRESH_COOKIE, base);
}

/** Body never contains the refresh token: it only ever travels in its httpOnly cookie. */
const sessionBody = (session: authService.Session) => ({
  data: { user: session.user, accessToken: session.accessToken, expiresIn: session.accessMaxAge / 1000 },
});

export async function login(req: Request, res: Response) {
  const { email, password } = req.validated.body;
  const session = await authService.login(email, password, meta(req));
  setSessionCookies(res, session);
  res.json(sessionBody(session));
}

export async function register(req: Request, res: Response) {
  const session = await authService.registerPatient(req.validated.body, meta(req));
  setSessionCookies(res, session);
  res.status(201).json(sessionBody(session));
}

export async function refresh(req: Request, res: Response) {
  try {
    const session = await authService.refresh(req.cookies?.[REFRESH_COOKIE], meta(req));
    setSessionCookies(res, session);
    res.json(sessionBody(session));
  } catch (error) {
    // Keep a racing tab's fresh cookies; clear them for every other failure.
    if ((error as { code?: string }).code !== 'REFRESH_RACE') clearSessionCookies(res);
    throw error;
  }
}

export async function logout(req: Request, res: Response) {
  await authService.logout(req.cookies?.[REFRESH_COOKIE]);
  clearSessionCookies(res);
  res.status(204).end();
}

export async function logoutAll(req: Request, res: Response) {
  await authService.logoutAll(req.user!.id);
  clearSessionCookies(res);
  res.status(204).end();
}

export async function me(req: Request, res: Response) {
  res.json({ data: await authService.getMe(req.user!.id) });
}

export async function updateProfile(req: Request, res: Response) {
  res.json({ data: await authService.updateProfile(req.user!.id, req.validated.body) });
}

export async function changePassword(req: Request, res: Response) {
  const session = await authService.changePassword(req.user!.id, req.validated.body, meta(req));
  setSessionCookies(res, session);
  res.json(sessionBody(session));
}
