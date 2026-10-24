import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { CookieOptions } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Role } from '../config/constants.js';
import { env } from '../config/env.js';
import { DoctorModel } from '../models/doctor.model.js';
import { RefreshTokenModel } from '../models/refreshToken.model.js';
import { UserModel, type UserDocument } from '../models/user.model.js';
import { ApiError } from '../utils/ApiError.js';
import { avatarUrl } from './avatar.service.js';
import type { ChangePasswordInput, RegisterInput, UpdateProfileInput } from '../validators/auth.validator.js';

/**
 * Session model
 * - Access token: JWT (HS256, 15 min) carrying id, role and doctor link. Verified
 *   statelessly on every request — no DB hit.
 * - Refresh token: 256-bit random string, stored only as a SHA-256 hash, rotated on
 *   every use. Reusing a rotated token revokes its whole family (stolen-token detection).
 * Both live in httpOnly cookies; the access token is also returned for Bearer clients.
 */

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  doctorId?: string;
}

interface AccessClaims {
  typ: 'access';
  role: Role;
  name: string;
  email: string;
  doctorId?: string;
}

export interface RequestMeta {
  userAgent?: string;
  ip?: string;
}

const ISSUER = 'doctor-tracker-api';
const AUDIENCE = 'doctor-tracker';
/** Two tabs refreshing at once: the loser presents a just-rotated token. Don't treat that as theft. */
const ROTATION_GRACE_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function toAuthUser(user: UserDocument | (Record<string, any> & { _id: unknown })): AuthUser {
  const doctorId = user.doctor ? String(user.doctor) : undefined;
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role as Role,
    ...(doctorId && { doctorId }),
  };
}

export function signAccessToken(user: AuthUser): string {
  const claims: AccessClaims = {
    typ: 'access',
    role: user.role,
    name: user.name,
    email: user.email,
    ...(user.doctorId && { doctorId: user.doctorId }),
  };
  return jwt.sign(claims, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.ACCESS_TOKEN_TTL as SignOptions['expiresIn'],
    issuer: ISSUER,
    audience: AUDIENCE,
    subject: user.id,
  });
}

export function verifyAccessToken(token: string): AuthUser {
  const decoded = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: ISSUER,
    audience: AUDIENCE,
  }) as AccessClaims & { sub: string };
  if (decoded.typ !== 'access' || !decoded.sub) throw new Error('Not an access token');
  return {
    id: decoded.sub,
    name: decoded.name,
    email: decoded.email,
    role: decoded.role,
    ...(decoded.doctorId && { doctorId: decoded.doctorId }),
  };
}

export const baseCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'lax',
  path: '/',
});

export interface Session {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  accessMaxAge: number;
  refreshMaxAge: number;
}

async function issueSession(user: UserDocument, meta: RequestMeta, family: string = randomUUID()): Promise<Session> {
  const authUser = toAuthUser(user);
  const accessToken = signAccessToken(authUser);
  const refreshToken = randomBytes(32).toString('base64url');
  const refreshMaxAge = env.REFRESH_TOKEN_TTL_DAYS * DAY_MS;

  await RefreshTokenModel.create({
    user: user._id,
    tokenHash: sha256(refreshToken),
    family,
    tokenVersion: user.tokenVersion,
    expiresAt: new Date(Date.now() + refreshMaxAge),
    userAgent: meta.userAgent?.slice(0, 300),
    ip: meta.ip,
  });

  const { exp, iat } = jwt.decode(accessToken) as { exp: number; iat: number };
  return { user: authUser, accessToken, refreshToken, accessMaxAge: (exp - iat) * 1000, refreshMaxAge };
}

const invalidCredentials = () => new ApiError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');

export async function login(email: string, password: string, meta: RequestMeta) {
  const user = (await UserModel.findOne({ email }).select('+password')) as UserDocument | null;
  // Same message (and a hash comparison either way) for unknown email and wrong password,
  // so responses don't reveal which accounts exist.
  const ok = user ? await user.comparePassword(password) : await fakeCompare();
  if (!user || !ok) throw invalidCredentials();
  user.lastLoginAt = new Date();
  await user.save();
  return issueSession(user, meta);
}

/** Spend the same time as a real bcrypt check for unknown emails (no timing oracle). */
let dummyHash: Promise<string> | undefined;
async function fakeCompare() {
  dummyHash ??= bcrypt.hash(randomBytes(16).toString('hex'), 12);
  await bcrypt.compare('not-the-password', await dummyHash);
  return false;
}

export async function registerPatient(input: RegisterInput, meta: RequestMeta) {
  const exists = await UserModel.exists({ email: input.email });
  if (exists) throw ApiError.conflict('An account with this email already exists', { field: 'email' });
  const user = (await UserModel.create({ ...input, role: 'patient' })) as UserDocument;
  return issueSession(user, meta);
}

/** Exchange a refresh token for a new pair (rotation). */
export async function refresh(rawToken: string | undefined, meta: RequestMeta) {
  if (!rawToken) throw new ApiError(401, 'No session', 'NO_SESSION');
  const record = await RefreshTokenModel.findOne({ tokenHash: sha256(rawToken) });
  if (!record) throw new ApiError(401, 'Session not found. Please sign in again.', 'INVALID_SESSION');

  if (record.revokedAt || record.replacedBy) {
    const rotatedRecently = record.revokedAt && Date.now() - record.revokedAt.getTime() < ROTATION_GRACE_MS && record.replacedBy;
    if (rotatedRecently) {
      // A parallel request already rotated this token; its new cookie is on the way.
      throw new ApiError(401, 'Session was just refreshed', 'REFRESH_RACE');
    }
    // A rotated token came back: someone else holds a copy. End every session in the family.
    await RefreshTokenModel.updateMany({ family: record.family, revokedAt: null }, { $set: { revokedAt: new Date() } });
    throw new ApiError(401, 'Session ended for your security. Please sign in again.', 'SESSION_REUSED');
  }
  if (record.expiresAt <= new Date()) throw new ApiError(401, 'Session expired. Please sign in again.', 'SESSION_EXPIRED');

  const user = (await UserModel.findById(record.user)) as UserDocument | null;
  if (!user || user.tokenVersion !== record.tokenVersion) {
    await RefreshTokenModel.updateMany({ family: record.family }, { $set: { revokedAt: new Date() } });
    throw new ApiError(401, 'Session ended. Please sign in again.', 'SESSION_REVOKED');
  }

  const session = await issueSession(user, meta, record.family);
  record.revokedAt = new Date();
  record.replacedBy = sha256(session.refreshToken);
  await record.save();
  return session;
}

/** Sign out this device: revoke the token's family. */
export async function logout(rawToken: string | undefined) {
  if (!rawToken) return;
  const record = await RefreshTokenModel.findOne({ tokenHash: sha256(rawToken) }).select('family').lean();
  if (record) await RefreshTokenModel.updateMany({ family: record.family, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

/** Sign out everywhere: bump the token version and revoke every refresh token. */
export async function logoutAll(userId: string) {
  await Promise.all([
    UserModel.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } }),
    RefreshTokenModel.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: new Date() } }),
  ]);
}

export async function changePassword(userId: string, input: ChangePasswordInput, meta: RequestMeta) {
  const user = (await UserModel.findById(userId).select('+password')) as UserDocument | null;
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  if (!(await user.comparePassword(input.currentPassword))) {
    throw ApiError.badRequest('Current password is incorrect', [{ field: 'currentPassword', message: 'Current password is incorrect' }]);
  }
  user.password = input.newPassword;
  user.tokenVersion += 1; // every other device is signed out
  await user.save();
  await RefreshTokenModel.updateMany({ user: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  return issueSession(user, meta); // this device stays signed in
}

export async function getMe(userId: string) {
  const user = await UserModel.findById(userId).lean();
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  const doctor = user.doctor
    ? await DoctorModel.findById(user.doctor).select('name specialization hospital').lean()
    : null;
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone,
    age: user.age,
    gender: user.gender,
    doctor: doctor ? { id: String(doctor._id), name: doctor.name, specialization: doctor.specialization, hospital: doctor.hospital } : null,
    avatarUrl: avatarUrl(user._id, user.avatarUpdatedAt),
    createdAt: user.createdAt,
  };
}

export async function updateProfile(userId: string, input: UpdateProfileInput) {
  await UserModel.updateOne({ _id: userId }, { $set: input }, { runValidators: true });
  return getMe(userId);
}

/** Create or reset the login for a roster doctor (admin action). */
export async function setDoctorAccount(doctorId: string, password: string) {
  const doctor = await DoctorModel.findById(doctorId).lean();
  if (!doctor) throw ApiError.notFound('Doctor');
  let user = (await UserModel.findOne({ doctor: doctor._id }).select('+password')) as UserDocument | null;
  if (user) {
    user.password = password;
    user.email = doctor.email;
    user.tokenVersion += 1;
    await user.save();
    await RefreshTokenModel.updateMany({ user: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  } else {
    const emailTaken = await UserModel.exists({ email: doctor.email });
    if (emailTaken) throw ApiError.conflict('Another account already uses this doctor’s email', { field: 'email' });
    user = (await UserModel.create({ name: doctor.name, email: doctor.email, password, role: 'doctor', doctor: doctor._id })) as UserDocument;
  }
  return { doctorId, email: user.email, hasAccount: true };
}
