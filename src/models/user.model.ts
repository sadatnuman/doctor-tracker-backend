import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import bcrypt from 'bcryptjs';
import { GENDERS, ROLES } from '../config/constants.js';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 120 },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true, default: 'patient' },
    /** Set for role "doctor": the roster entry this account signs in as. */
    doctor: { type: Schema.Types.ObjectId, ref: 'Doctor' },
    /** Patient self-registration details, used to open a patient record on a confirmed visit. */
    phone: { type: String, trim: true, maxlength: 20 },
    age: { type: Number, min: 0, max: 130 },
    gender: { type: String, enum: GENDERS },
    /**
     * Bumped on password change or "sign out everywhere". Refresh tokens issued with an
     * older version are rejected, which ends every other session within one access-token TTL.
     */
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: { type: Date },
    /** Set while the user has a profile picture; also versions its URL. */
    avatarUpdatedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret._id;
        delete ret.password;
        delete ret.tokenVersion;
        return ret;
      },
    },
  },
);

// One login per roster entry.
userSchema.index({ doctor: 1 }, { unique: true, partialFilterExpression: { doctor: { $exists: true } } });
userSchema.index({ role: 1, createdAt: -1 });

userSchema.pre('save', async function () {
  if (this.isModified('password')) this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = function (this: { password: string }, candidate: string) {
  return bcrypt.compare(candidate, this.password);
};

export type User = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<User> & { comparePassword(candidate: string): Promise<boolean> };
export type UserRole = User['role'];

export const UserModel = model('User', userSchema);
