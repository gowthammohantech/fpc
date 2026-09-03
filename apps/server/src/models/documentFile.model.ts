import { Schema, Types, model } from 'mongoose';
import { baseSchemaOptions, scopedFields } from './base.js';

/** Pointer to a blob held by the storage adapter (Azure Blob or local disk). */
export interface DocumentFileDoc {
  tenantId: Types.ObjectId;
  companyId: Types.ObjectId;
  /** Key within the storage container, e.g. `invoices/<id>/INV-9821.pdf`. */
  key: string;
  fileName: string;
  contentType: string;
  size: number;
  driver: string;
  checksum?: string;
  uploadedBy?: Types.ObjectId;
  kind: 'INVOICE' | 'PAYROLL_IMPORT' | 'BANK_STATEMENT' | 'BANK_FILE' | 'OTHER';
}

const schema = new Schema<DocumentFileDoc>(
  {
    ...scopedFields(),
    key: { type: String, required: true },
    fileName: { type: String, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    driver: { type: String, required: true },
    checksum: String,
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    kind: {
      type: String,
      enum: ['INVOICE', 'PAYROLL_IMPORT', 'BANK_STATEMENT', 'BANK_FILE', 'OTHER'],
      default: 'OTHER',
    },
  },
  baseSchemaOptions,
);

schema.index({ tenantId: 1, companyId: 1, kind: 1, createdAt: -1 });

export const DocumentFile = model<DocumentFileDoc>('DocumentFile', schema);
