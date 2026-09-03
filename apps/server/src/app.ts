import cors from 'cors';
import express, { type Express, Router } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { authenticate } from './middleware/authenticate.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { approvalRouter, approvalRuleRouter } from './modules/approvals/approval.routes.js';
import { invoiceRouter } from './modules/invoices/invoice.routes.js';
import { organizationRouter } from './modules/organization/index.js';
import { payableRouter } from './modules/payables/payable.routes.js';
import { paymentRouter } from './modules/payments/payment.routes.js';

export function createApp(): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins.length ? env.corsOrigins : true,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestId);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'fpc-api', time: new Date().toISOString() });
  });

  const api: Router = Router();
  api.use(
    rateLimit({
      windowMs: 60_000,
      limit: 600,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  // Public
  api.use('/auth', authRouter);

  // Everything below this line requires an authenticated principal; each
  // route additionally names the permission it needs.
  api.use(authenticate);
  api.use('/settings', organizationRouter);
  api.use('/invoices', invoiceRouter);
  api.use('/approvals', approvalRouter);
  api.use('/settings/approval-rules', approvalRuleRouter);
  api.use('/payables', payableRouter);
  api.use('/payments', paymentRouter);
  api.use('/audit', auditRouter);

  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
