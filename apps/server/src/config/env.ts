import { z } from 'zod';

/**
 * Environment configuration.
 *
 * Parsed and validated once at boot so a misconfigured deployment fails
 * immediately with a readable message rather than at the first request that
 * happens to need the missing value.
 */

/**
 * Boolean flag from the environment.
 *
 * Deliberately not `z.coerce.boolean()`: that is `Boolean(value)`, and every
 * environment variable is a string, so `"false"` coerces to `true` and the
 * flag can never be turned off. This reads the words people actually write in
 * a .env file and rejects anything ambiguous rather than guessing.
 */
export const booleanFlag = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(defaultValue)
    .transform((value, ctx) => {
      if (typeof value === 'boolean') return value;
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Expected a boolean like true/false, got "${value}"`,
      });
      return z.NEVER;
    });
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:8081'),

  MONGO_URI: z.string().default('mongodb://localhost:27017/fpc'),

  JWT_ACCESS_SECRET: z.string().min(16).default('dev-access-secret-change-me-in-production-000000'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(16)
    .default('dev-refresh-secret-change-me-in-production-00000'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  STORAGE_DRIVER: z.enum(['local', 'azure']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('.data/blobs'),
  AZURE_STORAGE_CONNECTION_STRING: z.string().optional(),
  AZURE_STORAGE_CONTAINER: z.string().default('fpc-documents'),

  MAIL_DRIVER: z.enum(['console', 'smtp', 'graph']).default('console'),
  MAIL_FROM: z.string().default('Elixir Finance Ops <finance-ops@example.com>'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_SECURE: booleanFlag(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  MAIL_FETCH_DRIVER: z.enum(['fixture', 'graph']).default('fixture'),
  MAIL_FIXTURE_DIR: z.string().default('fixtures/inbox'),
  GRAPH_TENANT_ID: z.string().optional(),
  GRAPH_CLIENT_ID: z.string().optional(),
  GRAPH_CLIENT_SECRET: z.string().optional(),
  GRAPH_MAILBOX: z.string().optional(),

  OCR_DRIVER: z.enum(['stub', 'claude', 'azure-doc-intelligence']).default('stub'),
  OCR_REVIEW_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),
  AZURE_DOC_INTEL_ENDPOINT: z.string().optional(),
  AZURE_DOC_INTEL_KEY: z.string().optional(),

  /**
   * Encrypts third-party OAuth tokens at rest. Must decode (base64 or hex) to
   * exactly 32 bytes — generate with `openssl rand -base64 32`.
   */
  SECRET_ENCRYPTION_KEY: z.string().default('fpc-dev-secret-encryption-key!!!'),
  /** Where the OAuth callback sends the browser back to. */
  WEB_APP_URL: z.string().url().default('http://localhost:5173'),

  OUTLOOK_ENABLED: booleanFlag(false),
  OUTLOOK_CLIENT_ID: z.string().optional(),
  OUTLOOK_CLIENT_SECRET: z.string().optional(),
  /** Azure tenant to authorise against; `common` allows any Microsoft account. */
  OUTLOOK_OAUTH_TENANT: z.string().default('common'),
  OUTLOOK_REDIRECT_URI: z.string().default('http://localhost:4000/api/auth/outlook/callback'),

  /**
   * Seeds the demo dataset during boot, for deployments with no shell to run
   * the seed script from. Only ever fires against an empty database.
   */
  SEED_ON_STARTUP: booleanFlag(false),

  JOBS_ENABLED: booleanFlag(true),
  MAIL_POLL_CRON: z.string().default('*/1 * * * *'),
  EXTRACTION_POLL_CRON: z.string().default('*/1 * * * *'),
  NOTIFICATION_POLL_CRON: z.string().default('*/1 * * * *'),
  /**
   * Reclaims syncs whose process died mid-run. This never contacts Microsoft —
   * it only repairs our own state, so it is not a mail poller.
   */
  OUTLOOK_SWEEP_CRON: z.string().default('*/5 * * * *'),
});

/**
 * Decodes the secret-encryption key, accepting base64 or hex.
 *
 * Exported so the boot guard and the crypto helper agree on what "32 bytes"
 * means rather than each parsing the string their own way.
 */
export function decodeEncryptionKey(value: string): Buffer {
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  const base64 = Buffer.from(value, 'base64');
  if (base64.length === 32) return base64;
  return Buffer.from(value, 'utf8');
}

export type Env = z.infer<typeof schema> & { corsOrigins: string[] };

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const value = parsed.data;

  // Fail loudly rather than silently running production on dev secrets.
  if (value.NODE_ENV === 'production') {
    if (
      value.JWT_ACCESS_SECRET.includes('change-me') ||
      value.JWT_REFRESH_SECRET.includes('change-me')
    ) {
      throw new Error('Refusing to start in production with the default JWT secrets');
    }
    if (value.STORAGE_DRIVER === 'azure' && !value.AZURE_STORAGE_CONNECTION_STRING) {
      throw new Error('STORAGE_DRIVER=azure requires AZURE_STORAGE_CONNECTION_STRING');
    }
    if (value.SECRET_ENCRYPTION_KEY.startsWith('fpc-dev-')) {
      throw new Error('Refusing to start in production with the default SECRET_ENCRYPTION_KEY');
    }
    if (decodeEncryptionKey(value.SECRET_ENCRYPTION_KEY).length !== 32) {
      throw new Error(
        'SECRET_ENCRYPTION_KEY must decode to exactly 32 bytes (openssl rand -base64 32)',
      );
    }
    if (value.OUTLOOK_ENABLED && (!value.OUTLOOK_CLIENT_ID || !value.OUTLOOK_CLIENT_SECRET)) {
      throw new Error('OUTLOOK_ENABLED=true requires OUTLOOK_CLIENT_ID and OUTLOOK_CLIENT_SECRET');
    }
    if (value.OUTLOOK_ENABLED && !value.OUTLOOK_REDIRECT_URI.startsWith('https://')) {
      throw new Error('OUTLOOK_REDIRECT_URI must be https in production');
    }
  }

  const corsOrigins = value.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  // The most common deployment mistake is a callback that redirects the browser
  // to an origin the API will then refuse, which fails long after the OAuth
  // round trip and looks like a Microsoft problem rather than a config one.
  if (corsOrigins.length && !corsOrigins.includes(new URL(value.WEB_APP_URL).origin)) {
    throw new Error(`WEB_APP_URL (${value.WEB_APP_URL}) must be one of CORS_ORIGINS`);
  }

  return { ...value, corsOrigins };
}

export const env: Env = load();
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
