import { Controller, Get, Header } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AffiliateService } from './affiliate.service';

@Controller('affiliate')
export class AffiliateController {
  constructor(private readonly affiliateService: AffiliateService) {}

  @Get('ugee/random')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  getRandomUgeeAsset() {
    return this.affiliateService.getRandomUgeeAsset();
  }
}
