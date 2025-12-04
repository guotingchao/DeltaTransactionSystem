import { Injectable } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';

export interface MarketAnalysis {
  topGainers: AnalyzedItem[];
  topLosers: AnalyzedItem[];
  totalItems: number;
  allItems: AnalyzedItem[];
}

export interface AnalyzedItem {
  name: string;
  price: number;
  avg24h: number;
  changePercent: number;
  category: string;
}

@Injectable()
export class AnalyzerService {
  constructor(private readonly prisma: PrismaService) {}

  async analyzeMarket(): Promise<MarketAnalysis> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // 获取所有物品
    const items = await this.prisma.item.findMany();
    const analyzedItems: AnalyzedItem[] = [];

    for (const item of items) {
      // 获取该物品过去 24 小时的价格记录
      const prices = await this.prisma.priceRecord.findMany({
        where: {
          itemId: item.id,
          recordedAt: { gte: oneDayAgo },
        },
        select: { price: true },
      });

      if (prices.length === 0) continue;

      const sum = prices.reduce((acc, curr) => acc + curr.price, 0);
      const avg24h = sum / prices.length;
      const currentPrice = item.latestPrice;

      // 计算变化百分比: (当前 - 均价) / 均价 * 100
      const changePercent = ((currentPrice - avg24h) / avg24h) * 100;

      analyzedItems.push({
        name: item.name,
        price: currentPrice,
        avg24h: Math.round(avg24h),
        changePercent: parseFloat(changePercent.toFixed(2)),
        category: item.category,
      });
    }

    // 排序
    analyzedItems.sort((a, b) => b.changePercent - a.changePercent);

    return {
      topGainers: analyzedItems.slice(0, 5),
      topLosers: analyzedItems.slice(-5).reverse(), // 跌幅最大的排前面
      totalItems: items.length,
      allItems: analyzedItems,
    };
  }
}
