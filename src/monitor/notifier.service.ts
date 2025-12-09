import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { AnalyzedItem, MarketAnalysis } from './analyzer.service';

@Injectable()
export class NotifierService {
  private readonly logger = new Logger(NotifierService.name);
  private readonly WEBHOOK_URL = process.env.WEBHOOKS_URL;

  // 定义分类映射
  private readonly CATEGORIES = {
    WEAPON: ['枪械', '头盔', '护甲', '配件', '弹匣'],
    SUPPLY: ['子弹', '消耗品'],
    KEY: ['钥匙'],
    COLLECTION: ['收集品'],
  };

  constructor(private readonly httpService: HttpService) {
    this.logger.log('NotifierService initialized v2.0 (Debug Enabled)');
  }

  async sendReport(analysis: MarketAnalysis) {
    if (!this.WEBHOOK_URL) {
      this.logger.warn('No Webhook URL configured, skipping notification.');
      return;
    }

    // 生成多条消息，避免超出字节限制
    const messages = this.generateMarkdownMessages(analysis);

    for (const [index, markdown] of messages.entries()) {
      try {
        const byteLength = Buffer.byteLength(markdown, 'utf8');
        this.logger.log(
          `Sending part ${index + 1}/${messages.length}. Length: ${markdown.length} chars, ${byteLength} bytes`,
        );

        const response = await firstValueFrom(
          this.httpService.post(this.WEBHOOK_URL, {
            msgtype: 'markdown',
            markdown: {
              content: markdown,
            },
          }),
        );

        const responseData = response.data;
        if (responseData && responseData.errcode && responseData.errcode !== 0) {
          this.logger.error(`Webhook error (Part ${index + 1}): ${JSON.stringify(responseData)}`);
        } else {
          this.logger.log(`Part ${index + 1} sent successfully.`);
        }

        // 简单的延时，避免触发频率限制
        if (index < messages.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (error) {
        this.logger.error(`Failed to send report part ${index + 1}`, error);
      }
    }
  }

  private generateMarkdownMessages(analysis: MarketAnalysis): string[] {
    const messages: string[] = [];
    const time = new Date().toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
    });

    // --- 消息 1: 核心日报头 + 高波动预警 ---
    let md1 = `## 📊 三角洲市场监控日报\n`;
    md1 += `<font color="comment">${time}</font>\n`;
    md1 += `> 📦 监控物品: **${analysis.totalItems}** 件\n`;
    md1 += `--------------------------------\n`;

    // 高波动检测 (涨跌幅绝对值 >= 20%)
    const highVolatilityItems = analysis.allItems.filter((i) => Math.abs(i.changePercent) >= 20);
    highVolatilityItems.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
    const topHighVol = highVolatilityItems.slice(0, 10);

    if (topHighVol.length > 0) {
      md1 += `\n⚠️ <font color="warning">**老板，一定要关注下！**</font> **@${process.env.BOSS_NAME}**\n`;
      md1 += `> 发现 **${highVolatilityItems.length}** 个物品波动剧烈 (展示 Top 10)：\n\n`;

      topHighVol.forEach((item) => {
        const isGain = item.changePercent > 0;
        const icon = isGain ? '🚀' : '💸';
        const color = 'warning';
        const sign = isGain ? '+' : '';
        md1 += `> ${icon} **${item.name}**\n`;
        md1 += `> 现价: ${item.price} | <font color="${color}">**${sign}${item.changePercent}%**</font>\n\n`;
      });
      md1 += `--------------------------------\n`;
    }
    messages.push(md1);

    // --- 消息 2: 武器与弹药榜单 ---
    let md2 = this.generateCategorySection(
      '🔫 武器配件',
      this.CATEGORIES.WEAPON,
      analysis.allItems,
    );
    md2 += this.generateCategorySection('💊 弹药补给', this.CATEGORIES.SUPPLY, analysis.allItems);
    if (md2.trim()) messages.push(md2);

    // --- 消息 3: 钥匙与藏品榜单 + 底部 ---
    let md3 = this.generateCategorySection('🔑 房卡钥匙', this.CATEGORIES.KEY, analysis.allItems);
    md3 += this.generateCategorySection(
      '💎 稀有藏品',
      this.CATEGORIES.COLLECTION,
      analysis.allItems,
    );

    if (md3.trim()) {
      md3 += `\n<font color="comment">数据来源: Gzc三角洲量化交易</font>`;
      messages.push(md3);
    } else if (messages.length > 0) {
      // 如果没有 md3 内容，把 footer 加到最后一条消息
      messages[messages.length - 1] += `\n<font color="comment">数据来源: Gzc三角洲量化交易</font>`;
    }

    return messages;
  }

  private generateCategorySection(
    title: string,
    categories: string[],
    allItems: AnalyzedItem[],
  ): string {
    const items = allItems.filter((i) => categories.includes(i.category));
    if (items.length === 0) return '';

    // 涨幅 Top 5
    const topGainers = items
      .filter((i) => i.changePercent > 0)
      .sort((a, b) => b.changePercent - a.changePercent)
      .slice(0, 5);

    // 跌幅 Top 5
    const topLosers = items
      .filter((i) => i.changePercent < 0)
      .sort((a, b) => a.changePercent - b.changePercent)
      .slice(0, 5);

    if (topGainers.length === 0 && topLosers.length === 0) return '';

    let section = `### ${title}\n`;

    if (topGainers.length > 0) {
      section += `**📈 ${title}涨幅榜**\n${this.formatTable(topGainers)}\n`;
    }

    if (topLosers.length > 0) {
      section += `**📉 ${title}跌幅榜**\n${this.formatTable(topLosers)}\n`;
    }

    return section;
  }

  private formatTable(items: AnalyzedItem[]): string {
    if (items.length === 0) return '> <font color="comment">暂无数据</font>\n';

    return items
      .map((item) => {
        let color = 'comment';

        if (item.changePercent > 0) {
          color = 'warning';
        } else if (item.changePercent < 0) {
          color = 'info';
        }

        const isBold = Math.abs(item.changePercent) >= 20;
        const changeStr = `${item.changePercent > 0 ? '+' : ''}${item.changePercent}%`;
        const priceStr = item.price.toLocaleString();

        // 计算预期净利润 (扣除 15% 手续费)
        const feeRate = 0.15;
        let netProfit = 0;
        if (item.changePercent > 0) {
          // 涨势：假设均价买入，现价卖出 (Profit = Price*0.85 - Avg)
          netProfit = item.price * (1 - feeRate) - item.avg24h;
        } else {
          // 跌势：假设现价买入，均价卖出 (Profit = Avg*0.85 - Price)
          netProfit = item.avg24h * (1 - feeRate) - item.price;
        }

        // 只有当有利可图时才显示利润额
        const profitStr = netProfit > 0 ? ` (💰${Math.round(netProfit)})` : '';

        return (
          `> ${item.name} | ${priceStr} | <font color="${color}">${isBold ? `**${changeStr}**` : changeStr}</font>` +
          `${profitStr}` +
          ` ${isBold ? '🔥' : ''}`
        );
      })
      .join('\n');
  }
}
