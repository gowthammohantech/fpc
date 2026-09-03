import { pino } from 'pino';
import { env, isProduction } from './env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  // Never let a secret or a full document body reach the log stream.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      '*.password',
      'passwordHash',
      '*.passwordHash',
      'refreshToken',
      '*.refreshToken',
    ],
    censor: '[redacted]',
  },
  ...(isProduction
    ? {}
    : { transport: { target: 'pino/file', options: { destination: 1 } } }),
});

export type Logger = typeof logger;
