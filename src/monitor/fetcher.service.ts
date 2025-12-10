import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma.service';

interface DeltaItem {
  id: number;
  is_get_time: number;
  name: string;
  price: number;
  secondClassCN: string;
}

@Injectable()
export class FetcherService {
  private readonly logger = new Logger(FetcherService.name);
  private readonly DATA_URL = process.env.PRICE_DATA_URL;

  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
  ) {}

  async fetchAndSyncData() {
    this.logger.log('Starting fetchAndSyncData v2.0 (Smart Update)');
    this.logger.log('Starting data fetch...');
    try {
      // 步骤1：获取远程数据
      const { data } = await firstValueFrom(this.httpService.get<DeltaItem[]>(this.DATA_URL));

      if (!Array.isArray(data)) {
        throw new Error('Invalid data format received');
      }

      this.logger.log(`Fetched ${data.length} items. Syncing to database...`);

      // 步骤2：预加载现有数据到内存（单次查询）
      const existingItems = await this.prisma.item.findMany({
        select: { id: true, latestPrice: true, name: true },
      });
      const existingItemMap = new Map(existingItems.map((item) => [item.id, item]));

      // 获取所有item的最新价格记录（用于去重和价格变化检测）
      const latestRecords = await this.prisma.priceRecord.groupBy({
        by: ['itemId'],
        _max: { recordedAt: true },
      });
      const latestRecordTimeMap = new Map(
        latestRecords.map((record) => [record.itemId, record._max.recordedAt]),
      );

      // 获取最新价格记录的实际价格值
      const latestPriceRecords = await this.prisma.priceRecord.findMany({
        where: {
          OR: Array.from(latestRecordTimeMap.entries()).map(([itemId, recordedAt]) => ({
            itemId,
            recordedAt: recordedAt!,
          })),
        },
        select: { itemId: true, price: true },
      });
      const latestPriceMap = new Map(
        latestPriceRecords.map((record) => [record.itemId, record.price]),
      );

      // 步骤3：在内存中分类数据
      const newItems: Array<{ id: number; name: string; category: string; latestPrice: number }> =
        [];
      const itemsToUpdate: Array<{ id: number; name: string; latestPrice: number }> = [];
      const newPriceRecords: Array<{ itemId: number; price: number; recordedAt: Date }> = [];

      for (const item of data) {
        const recordTime = new Date(item.is_get_time * 1000);
        const existingItem = existingItemMap.get(item.id);

        if (!existingItem) {
          // 新物品
          newItems.push({
            id: item.id,
            name: item.name,
            category: item.secondClassCN,
            latestPrice: item.price,
          });
        } else {
          // 仅当价格或名称发生变化时才更新物品信息
          // 这将极大减少数据库写入操作，解决超时问题
          if (existingItem.latestPrice !== item.price || existingItem.name !== item.name) {
            itemsToUpdate.push({
              id: item.id,
              name: item.name,
              latestPrice: item.price,
            });
          }
        }

        // 只在价格变化或首次记录时创建新价格记录（优化存储）
        const latestRecordTime = latestRecordTimeMap.get(item.id);
        const lastPrice = latestPriceMap.get(item.id);

        const isNewTime = !latestRecordTime || latestRecordTime.getTime() !== recordTime.getTime();
        const isPriceChanged = lastPrice === undefined || lastPrice !== item.price;

        if (isNewTime && isPriceChanged) {
          newPriceRecords.push({
            itemId: item.id,
            price: item.price,
            recordedAt: recordTime,
          });
        }
      }

      // 步骤4：批量执行数据库操作 (移除全局事务以避免超时)

      // 4.1 批量创建新物品
      if (newItems.length > 0) {
        await this.prisma.item.createMany({
          data: newItems,
          skipDuplicates: true,
        });
      }

      // 4.2 批量更新现有物品 (仅更新有变化的数据)
      if (itemsToUpdate.length > 0) {
        const BATCH_SIZE = 50;
        for (let i = 0; i < itemsToUpdate.length; i += BATCH_SIZE) {
          const chunk = itemsToUpdate.slice(i, i + BATCH_SIZE);
          const updatePromises = chunk.map((item) =>
            this.prisma.item.update({
              where: { id: item.id },
              data: {
                name: item.name,
                latestPrice: item.latestPrice,
                updatedAt: new Date(),
              },
            }),
          );
          await Promise.all(updatePromises);
        }
      }

      // 4.3 批量创建价格记录
      if (newPriceRecords.length > 0) {
        await this.prisma.priceRecord.createMany({
          data: newPriceRecords,
          skipDuplicates: true,
        });
      }

      const skippedPrices = data.length - newPriceRecords.length;
      this.logger.log(
        `Sync complete. ` +
          `New items: ${newItems.length}, ` +
          `Updated items: ${itemsToUpdate.length}, ` +
          `New price records: ${newPriceRecords.length}, ` +
          `Skipped (unchanged): ${skippedPrices}`,
      );
      return true;
    } catch (error) {
      this.logger.error('Failed to fetch data', error);
      throw error;
    }
  }
}
