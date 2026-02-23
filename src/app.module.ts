import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DetectorModule } from './detector/detector.module';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'short',
          ttl: 60_000, // 1 min (ms, throttler v6)
          limit: 3,
        },
        {
          name: 'daily',
          ttl: 86_400_000, // 24h
          limit: 10,
        },
      ],
    }),
    DetectorModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
  ],
})
export class AppModule {}
