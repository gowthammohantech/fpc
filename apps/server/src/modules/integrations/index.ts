import { Router } from 'express';
import { outlookRouter } from './outlook/outlook.routes.js';

/**
 * Third-party connectors a user attaches to their own account.
 *
 * Mounted under the authenticated part of the API. The one half that cannot
 * live here is the OAuth callback, which arrives as a plain browser redirect
 * with no Authorization header and so hangs off the public auth router.
 */
export const integrationsRouter: Router = Router();

integrationsRouter.use('/outlook', outlookRouter);
