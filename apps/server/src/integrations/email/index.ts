import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { ConsoleMailer } from './console.driver.js';
import { FixtureMailFetcher } from './fixture.driver.js';
import { GraphMailFetcher, GraphMailer } from './graph.driver.js';
import { SmtpMailer } from './smtp.driver.js';
import type { MailFetcher, Mailer } from './types.js';

export * from './types.js';
export { contentTypeFor } from './fixture.driver.js';

let mailerInstance: Mailer | null = null;
let fetcherInstance: MailFetcher | null = null;

export function mailer(): Mailer {
  if (mailerInstance) return mailerInstance;

  if (env.MAIL_DRIVER === 'graph') {
    mailerInstance = new GraphMailer(graphOptions(), env.GRAPH_MAILBOX ?? '');
  } else if (env.MAIL_DRIVER === 'smtp') {
    mailerInstance = new SmtpMailer(env.MAIL_FROM, {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    });
  } else {
    mailerInstance = new ConsoleMailer();
  }

  logger.info({ driver: mailerInstance.name }, 'mailer ready');
  return mailerInstance;
}

export function mailFetcher(): MailFetcher {
  if (fetcherInstance) return fetcherInstance;
  fetcherInstance =
    env.MAIL_FETCH_DRIVER === 'graph'
      ? new GraphMailFetcher(graphOptions())
      : new FixtureMailFetcher(env.MAIL_FIXTURE_DIR);
  logger.info({ driver: fetcherInstance.name }, 'inbound mail driver ready');
  return fetcherInstance;
}

function graphOptions() {
  if (!env.GRAPH_TENANT_ID || !env.GRAPH_CLIENT_ID || !env.GRAPH_CLIENT_SECRET) {
    throw new Error(
      'Microsoft Graph driver requires GRAPH_TENANT_ID, GRAPH_CLIENT_ID and GRAPH_CLIENT_SECRET',
    );
  }
  return {
    tenantId: env.GRAPH_TENANT_ID,
    clientId: env.GRAPH_CLIENT_ID,
    clientSecret: env.GRAPH_CLIENT_SECRET,
  };
}

/** Test seams. */
export function setMailer(driver: Mailer | null): void {
  mailerInstance = driver;
}
export function setMailFetcher(driver: MailFetcher | null): void {
  fetcherInstance = driver;
}
