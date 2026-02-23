import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { SkipThrottle } from '@nestjs/throttler';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @SkipThrottle({ short: true, daily: true })
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'alejo-lab-api',
      timestamp: new Date().toISOString(),
    };
  }
}
