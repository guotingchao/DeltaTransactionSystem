import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AnalyzerService } from './analyzer.service';
import { FetcherService } from './fetcher.service';
import { NotifierService } from './notifier.service';

@Injectable()
export class TasksService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly fetcher: FetcherService,
    private readonly analyzer: AnalyzerService,
    private readonly notifier: NotifierService,
  ) {}

  async onApplicationBootstrap() {
    this.logger.log('Application started. Market monitor is scheduled (Cron: */10).');
    // 调试用：取消下方注释可在启动5秒后立即执行一次
    setTimeout(() => this.handleCron(), 5000);
  }
  // 每10分钟执行一次
  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleCron() {
    this.logger.log('Starting scheduled market monitor task...');

    try {
      // 1. 同步数据
      await this.fetcher.fetchAndSyncData();

      // 2. 分析数据
      const analysis = await this.analyzer.analyzeMarket();

      // 3. 发送报告 (仅当有数据时)
      if (analysis.totalItems > 0) {
        await this.notifier.sendReport(analysis);
      }

      this.logger.log('Market monitor task completed.');
    } catch (error) {
      this.logger.error('Market monitor task failed', error);
    }
  }
}
