import { Module } from '@nestjs/common';
import { DetectorController } from './detector.controller';
import { DetectorService } from './detector.service';
import { TurnstileService } from '../security/turnstile.service';

@Module({
  controllers: [DetectorController],
  providers: [DetectorService, TurnstileService],
})
export class DetectorModule {}
