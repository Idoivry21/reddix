import type { NextFunction, Request, Response } from 'express';
import { buildSecretMap, redactSecrets, type SecretMap } from '../src/shared/redaction';

type LogFields = Record<string, unknown>;

interface LoggerOptions {
  secrets?: SecretMap;
  sink?: (line: string) => void;
}

/**
 * Structural subset of the logger that downstream modules depend on. Accepting
 * this (rather than the full {@link Logger}) keeps the execution layer decoupled
 * from the Express-specific `requestLogger` and lets callers pass a stub in tests.
 */
export interface EventLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/**
 * Minimal structured (JSON-line) logger that scrubs known auth secrets from
 * every emitted value, so tokens can never reach stdout/stderr logs.
 */
export function createLogger(options: LoggerOptions = {}) {
  const secrets = options.secrets ?? buildSecretMap(process.env);
  const sink = options.sink ?? ((line: string) => console.log(line));

  function emit(level: string, message: string, fields: LogFields): void {
    const payload = JSON.stringify({ level, message, ...fields });
    sink(redactSecrets(payload, secrets));
  }

  return {
    info: (message: string, fields: LogFields = {}) => emit('info', message, fields),
    warn: (message: string, fields: LogFields = {}) => emit('warn', message, fields),
    error: (message: string, fields: LogFields = {}) => emit('error', message, fields),
    /** Express middleware logging method, path, status, and duration per request. */
    requestLogger() {
      return (request: Request, response: Response, next: NextFunction): void => {
        const start = process.hrtime.bigint();
        response.on('finish', () => {
          const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
          emit('info', 'request', {
            method: request.method,
            path: request.path,
            status: response.statusCode,
            durationMs: Math.round(durationMs)
          });
        });
        next();
      };
    }
  };
}

export type Logger = ReturnType<typeof createLogger>;
