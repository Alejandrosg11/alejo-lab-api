import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MulterExceptionFilter } from './common/filters/multer-exception.filter';
import { PayloadTooLargeExceptionFilter } from './common/filters/payload-too-large-exception.filter';
import { NestExpressApplication } from '@nestjs/platform-express';
import { configureCors } from './common/configure-cors';
import { configureRequestAudit } from './common/request-audit';
import { validateClientIpConfiguration } from './common/client-ip';
import { configureOriginProtection } from './common/origin-protection';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // ConfigModule has loaded env; reject a missing Railway identity mode before
  // healthchecks can report this deployment ready.
  validateClientIpConfiguration();

  // Used by Express for protocol/host metadata, not client security identity.
  // Limits and Turnstile use the explicit public-edge/socket resolver instead.
  app.set('trust proxy', 1);

  configureRequestAudit(app);
  configureOriginProtection(app);
  configureCors(app);

  app.useGlobalFilters(
    new MulterExceptionFilter(),
    new PayloadTooLargeExceptionFilter(),
  );

  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
