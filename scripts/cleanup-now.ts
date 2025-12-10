import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanupNow() {
  console.log('🧹 Starting immediate cleanup...\n');

  // 统计清理前的数据
  const totalBefore = await prisma.priceRecord.count();
  const oldestBefore = await prisma.priceRecord.findFirst({
    orderBy: { recordedAt: 'asc' },
    select: { recordedAt: true },
  });

  console.log(`📊 Current status:`);
  console.log(`   Total records: ${totalBefore.toLocaleString()}`);
  console.log(`   Oldest record: ${oldestBefore?.recordedAt}`);

  // 计算7天前的时间
  const RETENTION_DAYS = 7;
  const cutoffDate = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  console.log(`\n🗑️  Deleting records older than: ${cutoffDate}`);
  console.log('⏳ This may take a minute...\n');

  const startTime = Date.now();
  const deleted = await prisma.priceRecord.deleteMany({
    where: {
      recordedAt: { lt: cutoffDate },
    },
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  // 统计清理后的数据
  const totalAfter = await prisma.priceRecord.count();
  const oldestAfter = await prisma.priceRecord.findFirst({
    orderBy: { recordedAt: 'asc' },
    select: { recordedAt: true },
  });

  console.log(`✅ Cleanup completed in ${duration}s\n`);
  console.log(`📊 Results:`);
  console.log(`   Deleted: ${deleted.count.toLocaleString()} records`);
  console.log(`   Remaining: ${totalAfter.toLocaleString()} records`);
  console.log(`   Oldest record now: ${oldestAfter?.recordedAt}`);
  console.log(`   Storage reduced by: ${Math.round((deleted.count / totalBefore) * 100)}%`);

  await prisma.$disconnect();
}

cleanupNow().catch(console.error);
