type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const weights: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let minimum: LogLevel = 'info';

export function configureLogger(level: LogLevel): void {
  minimum = level;
}

function write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (weights[level] < weights[minimum]) return;
  const payload = JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...context });
  if (level === 'error') console.error(payload);
  else if (level === 'warn') console.warn(payload);
  else console.log(payload);
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => write('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => write('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => write('warn', message, context),
  error: (message: string, error?: unknown, context?: Record<string, unknown>) =>
    write('error', message, {
      ...context,
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
    }),
};
