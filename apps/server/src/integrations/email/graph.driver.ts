import { ClientSecretCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';
import type {
  InboundAttachment,
  InboundMessage,
  MailFetcher,
  Mailer,
  OutboundMail,
} from './types.js';

const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';

interface GraphOptions {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

function graphClient(options: GraphOptions): Client {
  const credential = new ClientSecretCredential(
    options.tenantId,
    options.clientId,
    options.clientSecret,
  );

  return Client.init({
    authProvider: async (done) => {
      try {
        const token = await credential.getToken(GRAPH_SCOPE);
        done(null, token?.token ?? null);
      } catch (error) {
        done(error as Error, null);
      }
    },
  });
}

/** Sends mail as the configured mailbox via Microsoft Graph. */
export class GraphMailer implements Mailer {
  readonly name = 'graph';
  private readonly client: Client;

  constructor(
    options: GraphOptions,
    private readonly mailbox: string,
  ) {
    this.client = graphClient(options);
  }

  async send(mail: OutboundMail): Promise<{ messageId: string }> {
    await this.client.api(`/users/${this.mailbox}/sendMail`).post({
      message: {
        subject: mail.subject,
        body: { contentType: mail.html ? 'HTML' : 'Text', content: mail.html ?? mail.text },
        toRecipients: [{ emailAddress: { address: mail.to } }],
        ...(mail.replyTo ? { replyTo: [{ emailAddress: { address: mail.replyTo } }] } : {}),
        ...(mail.attachments?.length
          ? {
              attachments: mail.attachments.map((attachment) => ({
                '@odata.type': '#microsoft.graph.fileAttachment',
                name: attachment.filename,
                contentType: attachment.contentType,
                contentBytes: attachment.content.toString('base64'),
              })),
            }
          : {}),
      },
      saveToSentItems: true,
    });
    return { messageId: `graph-${Date.now()}` };
  }
}

/** Polls an Outlook mailbox for unread invoice emails with attachments. */
export class GraphMailFetcher implements MailFetcher {
  readonly name = 'graph';
  private readonly client: Client;

  constructor(options: GraphOptions) {
    this.client = graphClient(options);
  }

  async fetchUnread(mailbox: string, limit = 25): Promise<InboundMessage[]> {
    const response = (await this.client
      .api(`/users/${mailbox}/mailFolders/inbox/messages`)
      .filter('isRead eq false and hasAttachments eq true')
      .top(limit)
      .select('id,subject,from,toRecipients,receivedDateTime,bodyPreview')
      .get()) as { value: GraphMessage[] };

    const messages: InboundMessage[] = [];
    for (const message of response.value ?? []) {
      messages.push({
        messageId: message.id,
        from: message.from?.emailAddress?.address ?? '',
        to: (message.toRecipients ?? []).map((recipient) => recipient.emailAddress.address),
        subject: message.subject ?? '(no subject)',
        receivedAt: new Date(message.receivedDateTime),
        bodyPreview: message.bodyPreview,
        attachments: await this.attachmentsFor(mailbox, message.id),
      });
    }
    return messages;
  }

  async markProcessed(mailbox: string, messageId: string): Promise<void> {
    await this.client.api(`/users/${mailbox}/messages/${messageId}`).patch({ isRead: true });
  }

  private async attachmentsFor(mailbox: string, messageId: string): Promise<InboundAttachment[]> {
    const response = (await this.client
      .api(`/users/${mailbox}/messages/${messageId}/attachments`)
      .get()) as { value: GraphAttachment[] };

    return (response.value ?? [])
      .filter((attachment) => attachment['@odata.type'] === '#microsoft.graph.fileAttachment')
      .map((attachment) => ({
        filename: attachment.name,
        contentType: attachment.contentType,
        content: Buffer.from(attachment.contentBytes ?? '', 'base64'),
      }));
  }
}

interface GraphMessage {
  id: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime: string;
  from?: { emailAddress?: { address?: string } };
  toRecipients?: Array<{ emailAddress: { address: string } }>;
}

interface GraphAttachment {
  '@odata.type': string;
  name: string;
  contentType: string;
  contentBytes?: string;
}
