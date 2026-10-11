import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { AppConfig } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // Use Winston as the app-wide logger
  const logger = app.get(WINSTON_MODULE_NEST_PROVIDER);
  app.useLogger(logger);

  const configService = app.get(ConfigService);
  const config = configService.get<AppConfig>('app')!;

  // Security headers — allow cross-origin resource loading for images served to the web frontend
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // CORS — only allow configured frontend origins
  app.enableCors({
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
  });

  // Global validation pipe — strips unknown properties, transforms types
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false,
      },
    }),
  );

  // Global API prefix
  app.setGlobalPrefix('api/v1');

  // Swagger / OpenAPI
  const swaggerConfig = new DocumentBuilder()
    .setTitle('WearMe API')
    .setDescription('Virtual try-on platform API — V1')
    .setVersion('1.0')
    .addTag('try-on', 'Virtual try-on job management')
    .addTag('health', 'Service health checks')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(config.port);
  logger.log(`🚀 API running on http://localhost:${config.port}/api/v1`, 'Bootstrap');
  logger.log(`📚 Swagger docs at http://localhost:${config.port}/api/docs`, 'Bootstrap');
}

bootstrap();

