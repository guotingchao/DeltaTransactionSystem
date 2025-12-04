import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from 'nestjs-prisma';
import { MonitorModule } from './monitor/monitor.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MonitorModule,
    HttpModule.register({
      global: true,
    }),
    PrismaModule.forRootAsync({
      isGlobal: true,
      useFactory: () => ({
        prismaOptions: {
          log: ['error'],
          transactionOptions: {
            maxWait: 60 * 1000,
            timeout: 60 * 1000,
          },
        },
        explicitConnect: true,
      }),
    }),
  ],
})
export class AppModule {}
