import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MailConnectionView, MailIngestionRow } from '@fpc/api-client';
import { renderWithProviders } from '../test/render';
import { InvoiceMailboxPage } from './InvoiceMailbox';

/**
 * The screen exists to answer "what happened to my invoices?", so what these
 * assert is that each outcome is legible: the connect prompt when there is no
 * mailbox, a live strip while a sync runs, and per-attachment detail — including
 * the skips — on expanding a row.
 */

const mailApi = vi.hoisted(() => ({
  connection: vi.fn(),
  ingestions: vi.fn(),
  sync: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  updateConnection: vi.fn(),
  retry: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { mail: mailApi, settings: { companies: vi.fn() } },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    companyId: 'company-1',
    can: () => true,
    canAny: () => true,
  }),
}));

function connection(overrides: Partial<MailConnectionView> = {}): MailConnectionView {
  return {
    id: 'conn-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    ownerName: 'Ravi Kumar',
    provider: 'OUTLOOK',
    accountEmail: 'ravi@nova.example.com',
    status: 'CONNECTED',
    scopes: ['Mail.Read'],
    defaultCompanyId: 'company-1',
    defaultCompanyName: 'Nova Engineering',
    rules: {
      folder: 'inbox',
      senderAllowlist: [],
      subjectKeywords: [],
      allowedContentTypes: ['application/pdf'],
      maxMessagesPerSync: 25,
      lookbackDays: 30,
      companyRoutes: [],
    },
    autoSyncEnabled: false,
    syncState: 'IDLE',
    connectedAt: '2026-08-12T09:00:00.000Z',
    totalMessagesSeen: 4,
    totalInvoicesCreated: 3,
    createdAt: '2026-08-12T09:00:00.000Z',
    updatedAt: '2026-08-12T09:00:00.000Z',
    ...overrides,
  } as MailConnectionView;
}

function ingestion(overrides: Partial<MailIngestionRow> = {}): MailIngestionRow {
  return {
    id: 'ing-1',
    tenantId: 'tenant-1',
    companyId: 'company-1',
    connectionId: 'conn-1',
    userId: 'user-1',
    provider: 'OUTLOOK',
    providerMessageId: 'AAM=1',
    subject: 'Invoice INV-9821 for August',
    fromAddress: 'ap@vendor.com',
    fromName: 'TechZone AP',
    toAddresses: ['finance@nova.example.com'],
    receivedAt: '2026-09-01T10:00:00.000Z',
    status: 'COMPLETED',
    attachmentCount: 1,
    processedCount: 1,
    syncRunId: 'run-1',
    startedAt: '2026-09-01T10:01:00.000Z',
    completedAt: '2026-09-01T10:01:30.000Z',
    createdAt: '2026-09-01T10:01:00.000Z',
    updatedAt: '2026-09-01T10:01:30.000Z',
    attachments: [
      {
        name: 'invoice.pdf',
        contentType: 'application/pdf',
        size: 214_000,
        status: 'READY_FOR_REVIEW',
        invoiceId: 'inv-1',
        invoice: {
          id: 'inv-1',
          status: 'REVIEW_REQUIRED',
          invoiceNumber: 'INV-9821',
          vendorName: 'TechZone Systems',
          totalAmount: 3_540_000,
        },
      },
    ],
    ...overrides,
  } as MailIngestionRow;
}

function page(items: MailIngestionRow[]) {
  return { items, page: 1, pageSize: 25, total: items.length, totalPages: 1 };
}

beforeEach(() => {
  vi.clearAllMocks();
  mailApi.ingestions.mockResolvedValue(page([]));
});

describe('InvoiceMailboxPage', () => {
  it('offers to connect when no mailbox is attached', async () => {
    mailApi.connection.mockResolvedValue(null);
    renderWithProviders(<InvoiceMailboxPage />);

    expect(await screen.findByText('Connect your Outlook')).toBeInTheDocument();
    // The promise the consent screen makes, stated where the user decides.
    expect(screen.getByText(/Nothing in your mailbox is changed/)).toBeInTheDocument();
  });

  it('shows the connected account and what it has pulled', async () => {
    mailApi.connection.mockResolvedValue(connection({ lastSyncAt: '2026-09-01T10:02:00.000Z' }));
    renderWithProviders(<InvoiceMailboxPage />);

    expect(await screen.findByText('ravi@nova.example.com')).toBeInTheDocument();
    expect(screen.getByText(/4 emails · 3 invoices/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeEnabled();
  });

  it('says so plainly before the first sync, rather than showing empty counts', async () => {
    mailApi.connection.mockResolvedValue(connection());
    renderWithProviders(<InvoiceMailboxPage />);

    expect(await screen.findByText('Not synced yet')).toBeInTheDocument();
  });

  it('reports a sync in progress rather than leaving the screen silent', async () => {
    // The app has no toasts, and a sync outlives one anyway: a user who comes
    // back to the tab must still see that something is happening.
    mailApi.connection.mockResolvedValue(connection({ syncState: 'RUNNING', syncRunId: 'run-1' }));
    mailApi.ingestions.mockResolvedValue(page([ingestion({ status: 'PROCESSING' })]));
    renderWithProviders(<InvoiceMailboxPage />);

    expect(await screen.findByText(/Syncing your mailbox/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Syncing…' })).toBeDisabled();
  });

  it('reveals per-attachment outcomes and links to the invoice', async () => {
    mailApi.connection.mockResolvedValue(connection({ lastSyncAt: '2026-09-01T10:02:00.000Z' }));
    mailApi.ingestions.mockResolvedValue(page([ingestion()]));
    renderWithProviders(<InvoiceMailboxPage />);

    await screen.findByText('Invoice INV-9821 for August');
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }));

    expect(await screen.findByText('invoice.pdf')).toBeInTheDocument();
    expect(screen.getByText('Ready For Review')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /INV-9821/ })).toHaveAttribute(
      'href',
      '/invoices/inv-1',
    );
  });

  it('explains a skipped email and offers the one-click fix', async () => {
    mailApi.connection.mockResolvedValue(connection({ lastSyncAt: '2026-09-01T10:02:00.000Z' }));
    mailApi.ingestions.mockResolvedValue(
      page([
        ingestion({
          id: 'ing-2',
          status: 'SKIPPED',
          skipReason: 'SENDER_NOT_ALLOWED',
          processedCount: 0,
          attachments: [],
        }),
      ]),
    );
    renderWithProviders(<InvoiceMailboxPage />);

    await screen.findByText('Invoice INV-9821 for August');
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }));

    expect(await screen.findByText(/not on your allow list/)).toBeInTheDocument();

    mailApi.updateConnection.mockResolvedValue(connection());
    await userEvent.click(screen.getByRole('button', { name: /Allow ap@vendor.com/ }));

    await waitFor(() =>
      expect(mailApi.updateConnection).toHaveBeenCalledWith({
        rules: { senderAllowlist: ['ap@vendor.com'] },
      }),
    );
  });

  it('surfaces a broken connection with a way to repair it', async () => {
    mailApi.connection.mockResolvedValue(
      connection({
        status: 'REVOKED',
        statusMessage: 'Access was withdrawn in Microsoft 365. Reconnect to resume.',
      }),
    );
    renderWithProviders(<InvoiceMailboxPage />);

    expect(await screen.findByText(/Access was withdrawn/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
    // Nothing to sync until it is repaired, so the action is not offered.
    expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument();
  });

  it('tells the user nothing matched rather than showing a blank table', async () => {
    mailApi.connection.mockResolvedValue(connection({ lastSyncAt: '2026-09-01T10:02:00.000Z' }));
    renderWithProviders(<InvoiceMailboxPage />);

    expect(await screen.findByText('Nothing matched your rules')).toBeInTheDocument();
  });
});
