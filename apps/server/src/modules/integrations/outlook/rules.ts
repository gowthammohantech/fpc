import { MailSkipReason, SUPPORTED_INVOICE_CONTENT_TYPES } from '@fpc/shared';
import { MAX_ATTACHMENT_BYTES } from '../../../integrations/email/graphDelegated.driver.js';
import type {
  DelegatedMailQuery,
  InboundAttachment,
  InboundMessage,
} from '../../../integrations/email/types.js';
import type { MailSyncRulesDoc } from '../../../models/mailConnection.model.js';

/**
 * Deciding what a mailbox is allowed to give us.
 *
 * Everything here is pure: no database, no clock, no network. That is what
 * makes "why was this email skipped?" answerable by a unit test rather than by
 * re-running a sync against a real inbox.
 */

/** Why one attachment was set aside. Shown per file on the expanded row. */
export const AttachmentSkipReason = {
  UNSUPPORTED_TYPE: 'UNSUPPORTED_TYPE',
  TOO_LARGE: 'TOO_LARGE',
  INLINE: 'INLINE',
} as const;
export type AttachmentSkipReason = (typeof AttachmentSkipReason)[keyof typeof AttachmentSkipReason];

export interface MessageVerdict {
  accepted: boolean;
  skipReason?: MailSkipReason;
}

export interface PartitionedAttachments {
  supported: InboundAttachment[];
  skipped: Array<{ attachment: InboundAttachment; reason: AttachmentSkipReason }>;
}

/** Turns the stored rules into what the fetcher should ask the provider for. */
export function queryFromRules(rules: MailSyncRulesDoc, since?: Date): DelegatedMailQuery {
  return {
    folder: rules.folder || 'inbox',
    ...(since ? { since } : {}),
    senderAllowlist: rules.senderAllowlist,
    subjectKeywords: rules.subjectKeywords,
    limit: rules.maxMessagesPerSync,
  };
}

/**
 * Whether a message should be ingested at all.
 *
 * Runs before anything expensive, and a rejection is recorded rather than
 * dropped: a `SKIPPED` row with a reason is the only way a user can find out
 * why an invoice they were expecting never appeared.
 */
export function evaluateMessage(rules: MailSyncRulesDoc, message: InboundMessage): MessageVerdict {
  if (!matchesSender(rules.senderAllowlist, message.from)) {
    return { accepted: false, skipReason: MailSkipReason.SENDER_NOT_ALLOWED };
  }
  if (!matchesSubject(rules.subjectKeywords, message.subject)) {
    return { accepted: false, skipReason: MailSkipReason.SUBJECT_NOT_MATCHED };
  }

  const { supported, skipped } = partitionAttachments(rules, message.attachments);
  if (supported.length) return { accepted: true };

  if (!message.attachments.length) {
    return { accepted: false, skipReason: MailSkipReason.NO_ATTACHMENTS };
  }
  // "Everything was too big" is a different problem from "nothing was a PDF",
  // and only the first is worth retrying with a bigger cap.
  const allOversize =
    skipped.length > 0 && skipped.every((entry) => entry.reason === AttachmentSkipReason.TOO_LARGE);
  return {
    accepted: false,
    skipReason: allOversize
      ? MailSkipReason.ATTACHMENT_TOO_LARGE
      : MailSkipReason.UNSUPPORTED_ATTACHMENTS,
  };
}

/** An empty allow list means any sender, not no sender. */
export function matchesSender(allowlist: string[], from: string): boolean {
  if (!allowlist.length) return true;
  const address = from.trim().toLowerCase();
  if (!address) return false;
  const domain = address.slice(address.indexOf('@'));
  return allowlist.some((entry) => {
    const pattern = entry.trim().toLowerCase();
    return pattern.startsWith('@') ? domain === pattern : address === pattern;
  });
}

/** An empty keyword list means any subject. Matching is case-insensitive. */
export function matchesSubject(keywords: string[], subject: string): boolean {
  if (!keywords.length) return true;
  const value = (subject ?? '').toLowerCase();
  return keywords.some((keyword) => value.includes(keyword.trim().toLowerCase()));
}

/**
 * Splits attachments into what we can read and what we cannot, keeping the
 * reason for each rejection so the screen can explain itself file by file.
 */
export function partitionAttachments(
  rules: MailSyncRulesDoc,
  attachments: InboundAttachment[],
): PartitionedAttachments {
  const allowed = new Set(
    rules.allowedContentTypes?.length
      ? rules.allowedContentTypes
      : [...SUPPORTED_INVOICE_CONTENT_TYPES],
  );

  const supported: InboundAttachment[] = [];
  const skipped: PartitionedAttachments['skipped'] = [];

  for (const attachment of attachments) {
    // An inline signature logo makes `hasAttachments` true without there being
    // anything to read, so these are always dropped first.
    if (attachment.isInline) {
      skipped.push({ attachment, reason: AttachmentSkipReason.INLINE });
      continue;
    }
    if (!allowed.has(normalizeContentType(attachment.contentType))) {
      skipped.push({ attachment, reason: AttachmentSkipReason.UNSUPPORTED_TYPE });
      continue;
    }
    if ((attachment.size ?? attachment.content.length) > MAX_ATTACHMENT_BYTES) {
      skipped.push({ attachment, reason: AttachmentSkipReason.TOO_LARGE });
      continue;
    }
    supported.push(attachment);
  }

  return { supported, skipped };
}

/** `application/pdf; charset=binary` still means a PDF. */
function normalizeContentType(contentType: string): string {
  return (contentType ?? '').split(';')[0]!.trim().toLowerCase();
}

/**
 * Which company an email's invoices belong to.
 *
 * Rules are tried in specificity order — an exact address beats its domain,
 * which beats a subject keyword — so a general "everything from @vendor.com
 * goes to Nova" rule can be overridden for one address without reordering the
 * list. Falls back to the connection's default company.
 */
export function routeCompany(rules: MailSyncRulesDoc, message: InboundMessage): string | null {
  const from = (message.from ?? '').toLowerCase();
  const domain = from.slice(from.indexOf('@'));
  const subject = (message.subject ?? '').toLowerCase();
  const recipients = (message.to ?? []).map((address) => address.toLowerCase());
  const routes = rules.companyRoutes ?? [];

  const exactSender = routes.find(
    (route) => route.match === 'SENDER' && !route.value.startsWith('@') && route.value === from,
  );
  if (exactSender) return String(exactSender.companyId);

  const domainSender = routes.find(
    (route) => route.match === 'SENDER' && route.value.startsWith('@') && route.value === domain,
  );
  if (domainSender) return String(domainSender.companyId);

  const bySubject = routes.find(
    (route) => route.match === 'SUBJECT' && subject.includes(route.value),
  );
  if (bySubject) return String(bySubject.companyId);

  const byRecipient = routes.find(
    (route) =>
      route.match === 'TO' &&
      recipients.some((address) =>
        route.value.startsWith('@') ? address.endsWith(route.value) : address === route.value,
      ),
  );
  if (byRecipient) return String(byRecipient.companyId);

  return null;
}
