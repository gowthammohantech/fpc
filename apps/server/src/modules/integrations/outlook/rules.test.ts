import { describe, expect, it } from 'vitest';
import { MailSkipReason } from '@fpc/shared';
import type { InboundAttachment, InboundMessage } from '../../../integrations/email/types.js';
import type { MailSyncRulesDoc } from '../../../models/mailConnection.model.js';
import {
  AttachmentSkipReason,
  evaluateMessage,
  matchesSender,
  matchesSubject,
  partitionAttachments,
  routeCompany,
} from './rules.js';

const NOVA = '65b0f1a2c3d4e5f60718293a';
const ORION = '65b0f1a2c3d4e5f60718293b';

function rules(overrides: Partial<MailSyncRulesDoc> = {}): MailSyncRulesDoc {
  return {
    folder: 'inbox',
    senderAllowlist: [],
    subjectKeywords: [],
    allowedContentTypes: ['application/pdf', 'image/jpeg', 'image/png'],
    maxMessagesPerSync: 25,
    lookbackDays: 30,
    companyRoutes: [],
    ...overrides,
  } as MailSyncRulesDoc;
}

function pdf(overrides: Partial<InboundAttachment> = {}): InboundAttachment {
  return {
    filename: 'invoice.pdf',
    contentType: 'application/pdf',
    content: Buffer.from('%PDF-1.4'),
    size: 1024,
    ...overrides,
  };
}

function message(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    messageId: 'AAM=1',
    from: 'ap@vendor.com',
    to: ['finance@nova.example.com'],
    subject: 'Invoice INV-9821 for August',
    receivedAt: new Date('2026-09-01T10:00:00.000Z'),
    attachments: [pdf()],
    ...overrides,
  };
}

describe('matchesSender', () => {
  it('treats an empty allow list as any sender', () => {
    expect(matchesSender([], 'anyone@example.com')).toBe(true);
  });

  it('matches an exact address', () => {
    expect(matchesSender(['ap@vendor.com'], 'ap@vendor.com')).toBe(true);
    expect(matchesSender(['ap@vendor.com'], 'other@vendor.com')).toBe(false);
  });

  it('matches a whole domain', () => {
    expect(matchesSender(['@vendor.com'], 'anyone@vendor.com')).toBe(true);
    expect(matchesSender(['@vendor.com'], 'anyone@other.com')).toBe(false);
  });

  it('ignores case', () => {
    expect(matchesSender(['AP@Vendor.com'], 'ap@VENDOR.com')).toBe(true);
  });

  it('does not let a domain rule match a lookalike suffix', () => {
    expect(matchesSender(['@vendor.com'], 'x@notvendor.com')).toBe(false);
  });
});

describe('matchesSubject', () => {
  it('treats an empty keyword list as any subject', () => {
    expect(matchesSubject([], 'anything at all')).toBe(true);
  });

  it('matches any keyword, case-insensitively', () => {
    expect(matchesSubject(['invoice'], 'Your INVOICE is attached')).toBe(true);
    expect(matchesSubject(['invoice', 'bill'], 'Monthly bill')).toBe(true);
    expect(matchesSubject(['invoice'], 'Weekly newsletter')).toBe(false);
  });
});

describe('partitionAttachments', () => {
  it('keeps supported types', () => {
    const { supported, skipped } = partitionAttachments(rules(), [pdf()]);
    expect(supported).toHaveLength(1);
    expect(skipped).toHaveLength(0);
  });

  it('sets aside unsupported types with a reason', () => {
    const docx = pdf({
      filename: 'terms.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const { supported, skipped } = partitionAttachments(rules(), [docx]);
    expect(supported).toHaveLength(0);
    expect(skipped[0]?.reason).toBe(AttachmentSkipReason.UNSUPPORTED_TYPE);
  });

  it('excludes inline images such as signature logos', () => {
    const logo = pdf({ filename: 'logo.png', contentType: 'image/png', isInline: true });
    const { supported, skipped } = partitionAttachments(rules(), [logo]);
    expect(supported).toHaveLength(0);
    expect(skipped[0]?.reason).toBe(AttachmentSkipReason.INLINE);
  });

  it('sets aside oversize attachments', () => {
    const huge = pdf({ size: 40 * 1024 * 1024 });
    expect(partitionAttachments(rules(), [huge]).skipped[0]?.reason).toBe(
      AttachmentSkipReason.TOO_LARGE,
    );
  });

  it('tolerates a content type carrying parameters', () => {
    const withCharset = pdf({ contentType: 'application/pdf; charset=binary' });
    expect(partitionAttachments(rules(), [withCharset]).supported).toHaveLength(1);
  });
});

describe('evaluateMessage', () => {
  it('accepts a message that clears every rule', () => {
    expect(evaluateMessage(rules(), message()).accepted).toBe(true);
  });

  it('rejects a sender that is not on the allow list', () => {
    const verdict = evaluateMessage(rules({ senderAllowlist: ['@other.com'] }), message());
    expect(verdict.accepted).toBe(false);
    expect(verdict.skipReason).toBe(MailSkipReason.SENDER_NOT_ALLOWED);
  });

  it('rejects a subject that matches no keyword', () => {
    const verdict = evaluateMessage(rules({ subjectKeywords: ['statement'] }), message());
    expect(verdict.skipReason).toBe(MailSkipReason.SUBJECT_NOT_MATCHED);
  });

  it('reports an email with no attachments distinctly', () => {
    const verdict = evaluateMessage(rules(), message({ attachments: [] }));
    expect(verdict.skipReason).toBe(MailSkipReason.NO_ATTACHMENTS);
  });

  it('reports an email whose only attachments are unreadable', () => {
    const doc = pdf({ contentType: 'application/msword' });
    const verdict = evaluateMessage(rules(), message({ attachments: [doc] }));
    expect(verdict.skipReason).toBe(MailSkipReason.UNSUPPORTED_ATTACHMENTS);
  });

  it('separates an all-oversize message from an unreadable one', () => {
    // Only the first is worth retrying with a larger cap, so they are distinct
    // skip reasons rather than one catch-all.
    const huge = pdf({ size: 40 * 1024 * 1024 });
    const verdict = evaluateMessage(rules(), message({ attachments: [huge] }));
    expect(verdict.skipReason).toBe(MailSkipReason.ATTACHMENT_TOO_LARGE);
  });

  it('accepts a message where at least one attachment is readable', () => {
    const mixed = [pdf({ contentType: 'application/msword' }), pdf()];
    expect(evaluateMessage(rules(), message({ attachments: mixed })).accepted).toBe(true);
  });
});

describe('routeCompany', () => {
  it('returns null when no route matches, so the default applies', () => {
    expect(routeCompany(rules(), message())).toBeNull();
  });

  it('prefers an exact sender over its domain', () => {
    const routed = rules({
      companyRoutes: [
        { match: 'SENDER', value: '@vendor.com', companyId: ORION },
        { match: 'SENDER', value: 'ap@vendor.com', companyId: NOVA },
      ],
    } as unknown as Partial<MailSyncRulesDoc>);
    expect(routeCompany(routed, message())).toBe(NOVA);
  });

  it('falls back to a domain rule', () => {
    const routed = rules({
      companyRoutes: [{ match: 'SENDER', value: '@vendor.com', companyId: ORION }],
    } as unknown as Partial<MailSyncRulesDoc>);
    expect(routeCompany(routed, message())).toBe(ORION);
  });

  it('matches on a subject keyword when no sender rule applies', () => {
    const routed = rules({
      companyRoutes: [{ match: 'SUBJECT', value: 'inv-9821', companyId: ORION }],
    } as unknown as Partial<MailSyncRulesDoc>);
    expect(routeCompany(routed, message())).toBe(ORION);
  });

  it('matches on the recipient address', () => {
    const routed = rules({
      companyRoutes: [{ match: 'TO', value: '@nova.example.com', companyId: NOVA }],
    } as unknown as Partial<MailSyncRulesDoc>);
    expect(routeCompany(routed, message())).toBe(NOVA);
  });

  it('prefers a sender rule over a subject rule', () => {
    const routed = rules({
      companyRoutes: [
        { match: 'SUBJECT', value: 'invoice', companyId: ORION },
        { match: 'SENDER', value: 'ap@vendor.com', companyId: NOVA },
      ],
    } as unknown as Partial<MailSyncRulesDoc>);
    expect(routeCompany(routed, message())).toBe(NOVA);
  });
});
