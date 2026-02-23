import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MulterExceptionFilter } from './common/filters/multer-exception.filter';
import { PayloadTooLargeExceptionFilter } from './common/filters/payload-too-large-exception.filter';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Railway / reverse proxy
  app.set('trust proxy', 1);

  app.enableCors({
    origin: [
      'https://alejodraws.com',
      'http://localhost:3000', // para desarrollo local
    ],
  });

  app.useGlobalFilters(
    new MulterExceptionFilter(),
    new PayloadTooLargeExceptionFilter(),
  );

  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
