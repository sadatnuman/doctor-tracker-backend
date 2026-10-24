import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * Profile pictures, stored in MongoDB rather than on disk: free-tier hosts have
 * ephemeral file systems. The client resizes to a 256 px square WebP (~20–40 kB)
 * before upload, so a document per user stays small. Kept out of the user document
 * so user reads never carry image bytes.
 */
const avatarSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    data: { type: Buffer, required: true },
    contentType: { type: String, required: true, enum: ['image/jpeg', 'image/png', 'image/webp'] },
    size: { type: Number, required: true },
  },
  { timestamps: true },
);

export type Avatar = InferSchemaType<typeof avatarSchema>;
export const AvatarModel = model('Avatar', avatarSchema);
