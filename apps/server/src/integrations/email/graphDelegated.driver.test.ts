import { describe, expect, it } from 'vitest';
import { buildMessageFilter } from './graphDelegated.driver.js';
import type { DelegatedMailQuery } from './types.js';

function query(overrides: Partial<DelegatedMailQuery> = {}): DelegatedMailQuery {
  return { folder: 'inbox', limit: 25, ...overrides };
}

describe('buildMessageFilter', () => {
  it('always restricts to messages with attachments', () => {
    expect(buildMessageFilter(query())).toContain('hasAttachments eq true');
  });

  it('includes the watermark whenever one is known', () => {
    const since = new Date('2026-08-01T00:00:00.000Z');
    expect(buildMessageFilter(query({ since }))).toContain(
      'receivedDateTime ge 2026-08-01T00:00:00.000Z',
    );
  });

  it('inlines a short allow list of exact addresses', () => {
    const filter = buildMessageFilter(query({ senderAllowlist: ['ap@vendor.com', 'b@x.com'] }));
    expect(filter).toContain("from/emailAddress/address eq 'ap@vendor.com'");
    expect(filter).toContain("from/emailAddress/address eq 'b@x.com'");
  });

  it('falls back to post-filtering once the allow list grows', () => {
    const many = ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com', 'f@x.com'];
    expect(buildMessageFilter(query({ senderAllowlist: many }))).not.toContain('from/emailAddress');
  });

  it('falls back to post-filtering when any entry is a domain', () => {
    // Graph offers no `endswith` in a combined filter, so a single domain entry
    // takes the whole allow list into JavaScript.
    const filter = buildMessageFilter(query({ senderAllowlist: ['ap@vendor.com', '@other.com'] }));
    expect(filter).not.toContain('from/emailAddress');
  });

  it('never puts subject keywords in the filter', () => {
    // `$filter` has no contains() on subject, and `$search` cannot coexist with
    // the watermark clause. Subjects are matched in JavaScript instead.
    const filter = buildMessageFilter(query({ subjectKeywords: ['invoice', 'tax'] }));
    expect(filter).not.toContain('invoice');
    expect(filter).not.toContain('subject');
  });

  it('escapes quotes in an address rather than breaking the filter', () => {
    const filter = buildMessageFilter(query({ senderAllowlist: ["o'brien@x.com"] }));
    expect(filter).toContain("o''brien@x.com");
  });
});
