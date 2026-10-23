import type { Schema, UpdateQuery } from 'mongoose';

/**
 * Keeps a lower-cased copy of `name` in `nameLower` so name search can use an
 * anchored prefix regex backed by a regular B-tree index.
 */
export function nameLowerPlugin(schema: Schema) {
  schema.pre('validate', function () {
    const name = this.get('name');
    if (typeof name === 'string') this.set('nameLower', name.trim().toLowerCase());
  });

  schema.pre(['findOneAndUpdate', 'updateOne'], function () {
    const update = this.getUpdate() as UpdateQuery<{ name?: string }> | null;
    if (!update) return;
    const name = update.name ?? update.$set?.name;
    if (typeof name === 'string') this.setUpdate({ ...update, $set: { ...update.$set, nameLower: name.trim().toLowerCase() } });
  });
}

/** Shared JSON shape: expose `id`, hide `_id`, `__v` and internal search fields. */
export const toJSONOptions = {
  virtuals: true,
  versionKey: false,
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret._id;
    delete ret.nameLower;
    return ret;
  },
};
