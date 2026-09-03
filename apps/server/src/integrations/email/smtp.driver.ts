import nodemailer, { type Transporter } from 'nodemailer';
import type { Mailer, OutboundMail } from './types.js';

/** SMTP driver. Points at Mailpit locally; any relay in production. */
export class SmtpMailer implements Mailer {
  readonly name = 'smtp';
  private readonly transport: Transporter;

  constructor(
    private readonly from: string,
    options: { host: string; port: number; secure: boolean; user?: string; pass?: string },
  ) {
    this.transport = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      ...(options.user ? { auth: { user: options.user, pass: options.pass ?? '' } } : {}),
    });
  }

  async send(mail: OutboundMail): Promise<{ messageId: string }> {
    const info = await this.transport.sendMail({
      from: this.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      replyTo: mail.replyTo,
      attachments: mail.attachments,
    });
    return { messageId: info.messageId };
  }
}
