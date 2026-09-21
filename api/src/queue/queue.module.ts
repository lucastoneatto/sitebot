import { Global, Module } from '@nestjs/common';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { config } from '../config';

export const REDIS_CONNECTION = Symbol('REDIS_CONNECTION');
export const CRAWL_QUEUE = Symbol('CRAWL_QUEUE');

export const CRAWL_QUEUE_NAME = 'crawl';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CONNECTION,
      useFactory: () =>
        new IORedis(config.redisUrl, { maxRetriesPerRequest: null }),
    },
    {
      provide: CRAWL_QUEUE,
      useFactory: (connection: IORedis) =>
        new Queue(CRAWL_QUEUE_NAME, { connection }),
      inject: [REDIS_CONNECTION],
    },
  ],
  exports: [REDIS_CONNECTION, CRAWL_QUEUE],
})
export class QueueModule {}
