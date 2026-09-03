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
  MAIL_FROM: z.string().default('Finance Ops <finance-ops@example.com>'),
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

  JOBS_ENABLED: booleanFlag(true),
  MAIL_POLL_CRON: z.string().default('*/1 * * * *'),
  EXTRACTION_POLL_CRON: z.string().default('*/1 * * * *'),
  NOTIFICATION_POLL_CRON: z.string().default('*/1 * * * *'),
});

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
  }

  return {
    ...value,
    corsOrigins: value.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}

export const env: Env = load();
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
