import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from 'nestjs-prisma';

@Injectable()
export class CleanerService {
  private readonly logger = new Logger(CleanerService.name);

  // 配置：保留多少天的数据（7天足够分析24小时波动，且数据量可控）
  private readonly RETENTION_DAYS = 7;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 每天凌晨3点执行清理任务
   * 删除超过保留期限的价格记录
   */
  @Cron('0 3 * * *')
  async cleanOldRecords() {
    this.logger.log('Starting scheduled data cleanup...');
    const startTime = Date.now();

    try {
      const cutoffDate = new Date(Date.now() - this.RETENTION_DAYS * 24 * 60 * 60 * 1000);

      // 先查询要删除多少条
      const countToDelete = await this.prisma.priceRecord.count({
        where: {
          recordedAt: { lt: cutoffDate },
        },
      });

      if (countToDelete === 0) {
        this.logger.log('No old records to clean.');
        return;
      }

      this.logger.log(
        `Found ${countToDelete.toLocaleString()} records older than ${this.RETENTION_DAYS} days`,
      );

      // 分批删除，避免长时间锁表
      const BATCH_SIZE = 10000;
      let totalDeleted = 0;

      while (totalDeleted < countToDelete) {
        const deleted = await this.prisma.priceRecord.deleteMany({
          where: {
            recordedAt: { lt: cutoffDate },
          },
          take: BATCH_SIZE as never,
        });

        totalDeleted += deleted.count;
        this.logger.log(
          `Deleted ${totalDeleted.toLocaleString()}/${countToDelete.toLocaleString()} records`,
        );

        if (deleted.count < BATCH_SIZE) break;
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(
        `Cleanup completed. Deleted ${totalDeleted.toLocaleString()} records in ${duration}s`,
      );
    } catch (error) {
      this.logger.error('Failed to clean old records', error);
    }
  }

  /**
   * 手动触发清理（用于测试或紧急清理）
   */
  async manualClean(retentionDays: number = this.RETENTION_DAYS) {
    this.logger.log(`Manual cleanup triggered (retention: ${retentionDays} days)`);
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const deleted = await this.prisma.priceRecord.deleteMany({
      where: {
        recordedAt: { lt: cutoffDate },
      },
    });

    this.logger.log(`Manual cleanup completed. Deleted ${deleted.count.toLocaleString()} records`);
    return deleted.count;
  }

  /**
   * 获取数据库统计信息
   */
  async getStorageStats() {
    const total = await this.prisma.priceRecord.count();
    const oldest = await this.prisma.priceRecord.findFirst({
      orderBy: { recordedAt: 'asc' },
      select: { recordedAt: true },
    });
    const newest = await this.prisma.priceRecord.findFirst({
      orderBy: { recordedAt: 'desc' },
      select: { recordedAt: true },
    });

    return {
      totalRecords: total,
      oldestRecord: oldest?.recordedAt,
      newestRecord: newest?.recordedAt,
      retentionDays: this.RETENTION_DAYS,
    };
  }
}
