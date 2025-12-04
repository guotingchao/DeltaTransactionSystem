import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AnalyzerService } from './analyzer.service';
import { FetcherService } from './fetcher.service';
import { NotifierService } from './notifier.service';
import { TasksService } from './tasks.service';

@Module({
  providers: [PrismaService, FetcherService, AnalyzerService, NotifierService, TasksService],
})
export class MonitorModule {}
