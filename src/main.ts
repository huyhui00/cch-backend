import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { requestContextMiddleware } from './common/context/request-context';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RequestContextInterceptor } from './common/interceptors/request-context.interceptor';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { createValidationPipe } from './common/pipes/validation.pipe';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  const isProduction = config.get<string>('NODE_ENV') === 'production';

  // ---- Request context -----------------------------------------------------
  // ต้องมาก่อนทุกอย่าง เพื่อให้ทั้ง request วิ่งอยู่ใน AsyncLocalStorage เดียวกัน
  // Sequelize hook จึงรู้ได้ว่าใครเป็นผู้กระทำ โดยไม่ต้องส่งค่าผ่าน service (BR-09)
  app.use(requestContextMiddleware);

  // ---- Cache ---------------------------------------------------------------
  // ห้ามเบราว์เซอร์/proxy เก็บข้อมูลลูกค้าลงดิสก์ — ไม่งั้นหลังออกจากระบบบนเครื่องที่ใช้ร่วมกัน
  // ข้อมูลยังเปิดดูได้จาก cache และ proxy กลางทางอาจส่งคำตอบของคนหนึ่งให้อีกคน
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.set('etag', false);

  // ---- Global prefix -------------------------------------------------------
  // ทุก endpoint อยู่ใต้ /api ตาม CLAUDE.md 6.2
  app.setGlobalPrefix('api');

  // ---- CORS ----------------------------------------------------------------
  // เปิดเฉพาะ FRONTEND_URL เท่านั้น (Angular แยก repo คนละ origin)
  // รองรับหลาย origin โดยคั่นด้วย comma เช่น "http://localhost:4200,https://app.example.com"
  const frontendUrl = config.get<string>('FRONTEND_URL', '');
  const allowedOrigins = frontendUrl
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 86400,
  });

  // ---- Validation ----------------------------------------------------------
  app.useGlobalPipes(createValidationPipe());

  // ---- Response format (CLAUDE.md 6.1) ------------------------------------
  // เปิด log ทุก request อัตโนมัติเมื่อไม่ใช่ production ปิดได้ด้วย REQUEST_LOG=false
  // ประโยชน์หลักคือแยกให้ออกว่า frontend ยิงมาถึงจริงหรือถูกบล็อกที่เบราว์เซอร์
  const requestLogEnabled =
    (config.get<string>('REQUEST_LOG') ?? (isProduction ? 'false' : 'true')) === 'true';

  // ลำดับสำคัญ:
  //   RequestLoggingInterceptor อยู่หน้าสุด โค้ดหลัง handler ของมันจึงทำงานท้ายสุด
  //     ได้เวลาที่ใกล้เคียงของจริงที่สุด
  //   RequestContextInterceptor เติม userId ลง context ให้ทันก่อน controller เขียนฐานข้อมูล
  app.useGlobalInterceptors(
    new RequestLoggingInterceptor(requestLogEnabled),
    new RequestContextInterceptor(),
    new TransformInterceptor(),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  // ---- Swagger -------------------------------------------------------------
  // ปิดใน production เป็นค่าเริ่มต้น — ไม่ต้องแจกแผนที่ API ทั้งระบบให้คนที่ยังไม่ได้ล็อกอิน
  const swaggerEnabled =
    (config.get<string>('SWAGGER_ENABLED') ?? (isProduction ? 'false' : 'true')) === 'true';

  if (swaggerEnabled) {
    setupSwagger(app);
  }

  // ---- Listen --------------------------------------------------------------
  // ค่าจาก .env เป็น string เสมอ ต้องแปลงเป็นตัวเลขเอง
  const port = Number(config.get('PORT')) || 3000;
  await app.listen(port);

  // eslint-disable-next-line no-console
  console.log(`[cch-backend] running on http://localhost:${port}/api`);
  // eslint-disable-next-line no-console
  console.log(
    `[cch-backend] swagger  ${swaggerEnabled ? `on http://localhost:${port}/api/docs` : 'ปิดอยู่ (SWAGGER_ENABLED=false)'}`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `[cch-backend] CORS allowed origins: ${allowedOrigins.length > 0 ? allowedOrigins.join(', ') : '(none — FRONTEND_URL ยังไม่ได้ตั้งค่า)'}`,
  );
}

function setupSwagger(app: INestApplication): void {
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Internal Management System API')
    .setDescription(
      'ระบบบริหารจัดการลูกค้า โครงการ และบริการหลังการขาย (Backend) — ใช้งานภายในองค์กรเท่านั้น',
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        in: 'header',
      },
      'access-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}

void bootstrap();
