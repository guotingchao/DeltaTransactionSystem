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
  private readonly DATA_URL =
    'https://raw.githubusercontent.com/orzice/DeltaForcePrice/master/price.json';

  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
  ) {}

  async fetchAndSyncData() {
    this.logger.log('Starting data fetch...');
    try {
      const { data } = await firstValueFrom(this.httpService.get<DeltaItem[]>(this.DATA_URL));

      if (!Array.isArray(data)) {
        throw new Error('Invalid data format received');
      }

      this.logger.log(`Fetched ${data.length} items. syncing to database...`);

      let newRecords = 0;

      for (const item of data) {
        const recordTime = new Date(item.is_get_time * 1000);

        // 1. 更新或创建物品基础信息
        await this.prisma.item.upsert({
          where: { id: item.id },
          update: {
            latestPrice: item.price,
            updatedAt: new Date(),
            name: item.name,
          },
          create: {
            id: item.id,
            name: item.name,
            category: item.secondClassCN,
            latestPrice: item.price,
          },
        });

        // 2. 检查是否已存在该时间点的价格记录
        const existingRecord = await this.prisma.priceRecord.findFirst({
          where: {
            itemId: item.id,
            recordedAt: recordTime,
          },
        });

        if (!existingRecord) {
          await this.prisma.priceRecord.create({
            data: {
              itemId: item.id,
              price: item.price,
              recordedAt: recordTime,
            },
          });
          newRecords++;
        }
      }

      this.logger.log(`Sync complete. Added ${newRecords} new price records.`);
      return true;
    } catch (error) {
      this.logger.error('Failed to fetch data', error);
      throw error;
    }
  }
}
