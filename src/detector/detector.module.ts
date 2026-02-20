import { Module } from '@nestjs/common';
import { DetectorController } from './detector.controller';
import { DetectorService } from './detector.service';

@Module({
  controllers: [DetectorController],
  providers: [DetectorService],
})
export class DetectorModule {}
