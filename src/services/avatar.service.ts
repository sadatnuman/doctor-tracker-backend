import { Types } from 'mongoose';
import { AvatarModel } from '../models/avatar.model.js';
import { UserModel } from '../models/user.model.js';
import { ApiError } from '../utils/ApiError.js';

export const AVATAR_MAX_BYTES = 300 * 1024;
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Versioned URL: the `v` changes on every upload, so the image can be cached forever. */
export const avatarUrl = (userId: unknown, updatedAt?: Date | null) =>
  updatedAt ? `/api/avatars/${String(userId)}?v=${updatedAt.getTime()}` : null;

/** Trust the bytes, not the Content-Type header. */
function sniff(buffer: Buffer): (typeof AVATAR_TYPES)[number] | null {
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export async function setAvatar(userId: string, body: unknown) {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw ApiError.badRequest('Upload a JPEG, PNG or WebP image');
  }
  if (body.length > AVATAR_MAX_BYTES) throw new ApiError(413, 'Image is larger than 300 kB', 'PAYLOAD_TOO_LARGE');
  const contentType = sniff(body);
  if (!contentType) throw ApiError.badRequest('Upload a JPEG, PNG or WebP image');

  const now = new Date();
  await AvatarModel.updateOne(
    { user: new Types.ObjectId(userId) },
    { $set: { data: body, contentType, size: body.length, updatedAt: now } },
    { upsert: true },
  );
  await UserModel.updateOne({ _id: userId }, { $set: { avatarUpdatedAt: now } });
  return { avatarUrl: avatarUrl(userId, now) };
}

export async function removeAvatar(userId: string) {
  await Promise.all([
    AvatarModel.deleteOne({ user: new Types.ObjectId(userId) }),
    UserModel.updateOne({ _id: userId }, { $unset: { avatarUpdatedAt: 1 } }),
  ]);
  return { avatarUrl: null };
}

export async function getAvatar(userId: string) {
  const avatar = await AvatarModel.findOne({ user: new Types.ObjectId(userId) }).lean();
  if (!avatar) throw ApiError.notFound('Image');
  return avatar;
}

/** doctorId → avatar URL of the doctor's login, for one page of doctors (single query). */
export async function doctorAccounts(doctorIds: Types.ObjectId[]) {
  if (doctorIds.length === 0) return new Map<string, { avatarUrl: string | null }>();
  const users = await UserModel.find({ doctor: { $in: doctorIds } }).select('doctor avatarUpdatedAt').lean();
  return new Map(users.map((u) => [String(u.doctor), { avatarUrl: avatarUrl(u._id, u.avatarUpdatedAt) }]));
}
