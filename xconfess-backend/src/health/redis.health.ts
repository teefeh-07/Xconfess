import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

function resolveDisabledReason(rawValue: unknown): string {
  if (rawValue === 'false') {
    return 'ENABLE_BACKGROUND_JOBS is set to "false" (background jobs intentionally disabled)';
  }
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return 'ENABLE_BACKGROUND_JOBS is not set (defaults to disabled)';
  }
  return `ENABLE_BACKGROUND_JOBS is set to "${String(rawValue)}" (expected "true" to enable)`;
}

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(RedisHealthIndicator.name);

  constructor(private readonly configService: ConfigService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const rawConfig = this.configService.get<string | undefined>(
      'ENABLE_BACKGROUND_JOBS',
    );
    const jobsEnabled = rawConfig === 'true';

    if (!jobsEnabled) {
      return this.getStatus(key, true, {
        mode: 'disabled',
        reason: resolveDisabledReason(rawConfig),
        severity: 'info',
      });
    }

    const host =
      this.configService.get<string>('REDIS_HOST') || 'localhost';
    const port = this.configService.get<number>('REDIS_PORT') || 6379;

    const client = new Redis({
      host,
      port,
      connectTimeout: 2000,
      lazyConnect: true,
      retryStrategy: () => null,
    });

    try {
      await client.connect();
      await client.ping();
      return this.getStatus(key, true, { host, port });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Redis health check failed: ${message}`);
      throw new HealthCheckError(
        'Redis is unreachable',
        this.getStatus(key, false, { host, port, error: message }),
      );
    } finally {
      try {
        await client.disconnect();
      } catch {
        // ignore disconnect errors
      }
    }
  }
}
