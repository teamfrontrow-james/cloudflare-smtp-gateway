/**
 * Layered configuration.
 *
 * Precedence (highest first):
 *   1. Environment variables  — also "lock" that field (admin UI shows it read-only)
 *   2. ./data/config.json     — written by the admin web UI
 *   3. built-in defaults
 *
 * This lets the same image run fully headless from env (Docker/CI) OR be set up
 * click-by-click in the browser, without the two fighting each other.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface SmtpUser {
  username: string;
  password: string;
}

export interface AppConfig {
  cfApiToken: string;
  cfAccountId: string;
  allowedFrom: string[];
  smtpUsers: SmtpUser[];
  httpToken: string;
  adminPassword: string;
  smtpPort: number;
  httpPort: number;
  bindHost: string;
  adminLocalhostOnly: boolean;
  tlsCertPath: string;
  tlsKeyPath: string;
  rateLimitPerMinute: number;
  rateLimitPerDay: number;
  recipientAllowlist: string[];
  recipientDenylist: string[];
  allowedOrigins: string[];
  turnstileSecret: string;
  logLevel: string;
  dataDir: string;
}

/** Subset of config the admin UI is allowed to write back to disk. */
export type PersistedConfig = Partial<
  Pick<
    AppConfig,
    | 'cfApiToken'
    | 'cfAccountId'
    | 'allowedFrom'
    | 'smtpUsers'
    | 'httpToken'
    | 'recipientAllowlist'
    | 'recipientDenylist'
    | 'allowedOrigins'
    | 'rateLimitPerMinute'
    | 'rateLimitPerDay'
  >
>;

const DEFAULTS: AppConfig = {
  cfApiToken: '',
  cfAccountId: '',
  allowedFrom: [],
  smtpUsers: [],
  httpToken: '',
  adminPassword: '',
  smtpPort: 2525,
  httpPort: 3000,
  bindHost: '127.0.0.1',
  adminLocalhostOnly: true,
  tlsCertPath: '',
  tlsKeyPath: '',
  rateLimitPerMinute: 30,
  rateLimitPerDay: 1000,
  recipientAllowlist: [],
  recipientDenylist: [],
  allowedOrigins: [],
  turnstileSecret: '',
  logLevel: 'info',
  dataDir: './data',
};

// Maps an env var name to the AppConfig key it seeds.
const ENV_MAP: Record<string, keyof AppConfig> = {
  CF_API_TOKEN: 'cfApiToken',
  CF_ACCOUNT_ID: 'cfAccountId',
  ALLOWED_FROM: 'allowedFrom',
  SMTP_USERS: 'smtpUsers',
  HTTP_TOKEN: 'httpToken',
  ADMIN_PASSWORD: 'adminPassword',
  SMTP_PORT: 'smtpPort',
  HTTP_PORT: 'httpPort',
  BIND_HOST: 'bindHost',
  ADMIN_LOCALHOST_ONLY: 'adminLocalhostOnly',
  TLS_CERT_PATH: 'tlsCertPath',
  TLS_KEY_PATH: 'tlsKeyPath',
  RATE_LIMIT_PER_MINUTE: 'rateLimitPerMinute',
  RATE_LIMIT_PER_DAY: 'rateLimitPerDay',
  RECIPIENT_ALLOWLIST: 'recipientAllowlist',
  RECIPIENT_DENYLIST: 'recipientDenylist',
  ALLOWED_ORIGINS: 'allowedOrigins',
  TURNSTILE_SECRET: 'turnstileSecret',
  LOG_LEVEL: 'logLevel',
  DATA_DIR: 'dataDir',
};

function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseSmtpUsers(raw: string): SmtpUser[] {
  return splitList(raw).map((pair) => {
    const idx = pair.indexOf(':');
    if (idx === -1) return { username: pair, password: '' };
    return { username: pair.slice(0, idx), password: pair.slice(idx + 1) };
  });
}

/** Coerce a raw string env value into the type of the target config field. */
function coerce(key: keyof AppConfig, raw: string): unknown {
  switch (key) {
    case 'allowedFrom':
    case 'recipientAllowlist':
    case 'recipientDenylist':
    case 'allowedOrigins':
      return splitList(raw);
    case 'smtpUsers':
      return parseSmtpUsers(raw);
    case 'smtpPort':
    case 'httpPort':
    case 'rateLimitPerMinute':
    case 'rateLimitPerDay':
      return Number(raw);
    case 'adminLocalhostOnly':
      return raw !== 'false' && raw !== '0';
    default:
      return raw;
  }
}

let cached: { config: AppConfig; envLocked: Set<keyof AppConfig> } | null = null;

function readPersisted(dataDir: string): PersistedConfig {
  const file = join(resolve(dataDir), 'config.json');
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as PersistedConfig;
  } catch {
    return {};
  }
}

/** Load (and cache) the merged config. Call reloadConfig() after a GUI save. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const envLocked = new Set<keyof AppConfig>();
  const fromEnv: Partial<AppConfig> = {};
  for (const [envName, key] of Object.entries(ENV_MAP)) {
    const raw = env[envName];
    if (raw !== undefined && raw !== '') {
      (fromEnv as Record<string, unknown>)[key] = coerce(key, raw);
      envLocked.add(key);
    }
  }

  // dataDir must be resolved before reading the persisted file.
  const dataDir = fromEnv.dataDir ?? DEFAULTS.dataDir;
  const persisted = readPersisted(dataDir);

  const config: AppConfig = { ...DEFAULTS, ...persisted, ...fromEnv };
  cached = { config, envLocked };
  return config;
}

export function getConfig(): AppConfig {
  if (!cached) return loadConfig();
  return cached.config;
}

export function reloadConfig(): AppConfig {
  cached = null;
  return loadConfig();
}

/** Field names whose value came from an env var (admin UI renders these read-only). */
export function lockedFields(): (keyof AppConfig)[] {
  if (!cached) loadConfig();
  return [...(cached?.envLocked ?? [])];
}

/**
 * Persist admin-UI changes. Env-locked fields are silently dropped so a saved
 * file can never shadow an explicit env var. Returns the freshly reloaded config.
 */
export function savePersisted(update: PersistedConfig): AppConfig {
  if (!cached) loadConfig();
  const locked = cached?.envLocked ?? new Set();
  const dataDir = resolve(getConfig().dataDir);
  mkdirSync(dataDir, { recursive: true });

  const current = readPersisted(dataDir);
  const next: PersistedConfig = { ...current };
  for (const [k, v] of Object.entries(update)) {
    if (locked.has(k as keyof AppConfig)) continue;
    (next as Record<string, unknown>)[k] = v;
  }
  writeFileSync(join(dataDir, 'config.json'), JSON.stringify(next, null, 2));
  return reloadConfig();
}
