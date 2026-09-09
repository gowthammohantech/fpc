export const OUTLOOK_MAILBOX_UNAVAILABLE_REASON = 'mailbox_unavailable';

export class OutlookMailboxUnavailableError extends Error {
  constructor() {
    super(
      "Microsoft Graph could not access this account's Outlook mailbox. Reconnect with a mailbox-enabled Microsoft 365 or Outlook.com account.",
    );
    this.name = 'OutlookMailboxUnavailableError';
  }
}
