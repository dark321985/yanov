import { config as loadDotEnv } from 'dotenv';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  APP_URL: z.url().default('http://127.0.0.1:5173'),
  APP_TIMEZONE: z.string().default('Europe/Moscow').refine((timezone) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  }),
  DATABASE_URL: z.union([z.literal(''), z.url()]).optional(),
  DATABASE_TLS: z.enum(['disabled', 'verify-full']).optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(1).default(0),
  RUN_SCHEDULER: z.enum(['true','false']).default('true'),
});

export class ConfigurationError extends Error {
  constructor(readonly fields: string[]) {
    super('Invalid application configuration');
  }
}

export function parseConfig(input: Record<string, unknown>) {
  const result = schema.safeParse(input);
  if (!result.success) {
    // Field names are safe; validator messages may contain rejected secrets.
    throw new ConfigurationError([...new Set(result.error.issues.map((issue) => String(issue.path[0])))]);
  }
  const config = result.data;
  if (config.NODE_ENV === 'production' && !config.APP_URL.startsWith('https://')) {
    throw new ConfigurationError(['APP_URL']);
  }
  if (config.DATABASE_URL) {
    const url = new URL(config.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
      throw new ConfigurationError(['DATABASE_URL']);
    }
    // TLS is set explicitly below. A connection-string option must not weaken it.
    for (const key of ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert']) {
      if (url.searchParams.has(key)) throw new ConfigurationError(['DATABASE_URL']);
    }
  }
  return {
    ...config,
    DATABASE_TLS: config.DATABASE_TLS ?? (config.NODE_ENV === 'production' ? 'verify-full' : 'disabled'),
  };
}

export type AppConfig = ReturnType<typeof parseConfig>;

export function loadConfig(): AppConfig {
  loadDotEnv({ quiet: true });
  return parseConfig(process.env);
}
