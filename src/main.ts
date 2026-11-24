import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MulterExceptionFilter } from './common/filters/multer-exception.filter';
import { PayloadTooLargeExceptionFilter } from './common/filters/payload-too-large-exception.filter';
import { NestExpressApplication } from '@nestjs/platform-express';
import { configureCors } from './common/configure-cors';
import { configureRequestAudit } from './common/request-audit';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Used by Express for protocol/host metadata, not client security identity.
  // Limits and Turnstile use the explicit public-edge/socket resolver instead.
  app.set('trust proxy', 1);

  configureRequestAudit(app);
  configureCors(app);

  app.useGlobalFilters(
    new MulterExceptionFilter(),
    new PayloadTooLargeExceptionFilter(),
  );

  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
