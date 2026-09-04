import { Schema, Types } from 'mongoose';

/** Options shared by every collection: timestamps and a clean JSON shape. */
export const baseSchemaOptions = {
  timestamps: true,
  versionKey: false,
  toJSON: {
    virtuals: true,
    transform(_doc: unknown, ret: Record<string, unknown>) {
      ret.id = String(ret._id);
      delete ret._id;
      delete ret.passwordHash;
      // Belt and braces with `select: false` on the schema: a secret that is
      // never serialised cannot leak through a route that forgot to map.
      delete ret.accessTokenCipher;
      delete ret.refreshTokenCipher;
      return ret;
    },
  },
  toObject: { virtuals: true },
} as const;

export type ObjectId = Types.ObjectId;

/** Required tenant + company scoping present on every business collection. */
export function scopedFields() {
  return {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  } as const;
}

/** Converts a lean document to the API shape (`_id` → `id`, dates → ISO). */
export function toApi(doc: unknown): Record<string, unknown> | null {
  if (!doc || typeof doc !== 'object') return null;
  // Destructured only to drop them from the API shape.
  const { _id, passwordHash: _passwordHash, ...rest } = doc as Record<string, unknown>;
  return { id: String(_id), ...serializeDates(rest) };
}

function serializeDates(value: unknown): any {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Types.ObjectId) return String(value);
  if (Array.isArray(value)) return value.map(serializeDates);
  if (value && typeof value === 'object' && (value as object).constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = key === '_id' ? String(item) : serializeDates(item);
    }
    return out;
  }
  return value;
}
