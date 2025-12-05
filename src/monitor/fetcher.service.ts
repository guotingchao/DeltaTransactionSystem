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
        select: { id: true, latestPrice: true },
      });
      const existingItemMap = new Map(existingItems.map((item) => [item.id, item]));

      // 获取所有item的最新价格记录时间（用于去重）
      const latestRecords = await this.prisma.priceRecord.groupBy({
        by: ['itemId'],
        _max: { recordedAt: true },
      });
      const latestRecordTimeMap = new Map(
        latestRecords.map((record) => [record.itemId, record._max.recordedAt]),
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
          // 更新现有物品
          itemsToUpdate.push({
            id: item.id,
            name: item.name,
            latestPrice: item.price,
          });
        }

        // 检查是否需要创建新的价格记录
        const latestRecordTime = latestRecordTimeMap.get(item.id);
        if (!latestRecordTime || latestRecordTime.getTime() !== recordTime.getTime()) {
          newPriceRecords.push({
            itemId: item.id,
            price: item.price,
            recordedAt: recordTime,
          });
        }
      }

      // 步骤4：使用事务批量执行数据库操作
      await this.prisma.$transaction(async (tx) => {
        // 批量创建新物品
        if (newItems.length > 0) {
          await tx.item.createMany({
            data: newItems,
            skipDuplicates: true,
          });
        }

        // 批量更新现有物品
        if (itemsToUpdate.length > 0) {
          const updatePromises = itemsToUpdate.map((item) =>
            tx.item.update({
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

        // 批量创建价格记录
        if (newPriceRecords.length > 0) {
          await tx.priceRecord.createMany({
            data: newPriceRecords,
            skipDuplicates: true,
          });
        }
      });

      this.logger.log(
        `Sync complete. ` +
          `New items: ${newItems.length}, ` +
          `Updated items: ${itemsToUpdate.length}, ` +
          `New price records: ${newPriceRecords.length}`,
      );
      return true;
    } catch (error) {
      this.logger.error('Failed to fetch data', error);
      throw error;
    }
  }
}
