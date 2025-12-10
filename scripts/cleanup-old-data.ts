import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanupOldData() {
  const RETENTION_DAYS = 30; // 保留30天数据
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

  console.log(`🗑️  Starting cleanup...`);
  console.log(`📅 Cutoff date: ${cutoffDate.toISOString()}`);

  try {
    // 统计将要删除的记录数
    const countToDelete = await prisma.priceRecord.count({
      where: {
        recordedAt: { lt: cutoffDate },
      },
    });

    console.log(`📊 Records to delete: ${countToDelete.toLocaleString()}`);

    if (countToDelete === 0) {
      console.log('✅ No old data to clean up.');
      return;
    }

    // 确认提示
    console.log(`\n⚠️  This will delete ${countToDelete.toLocaleString()} records older than ${RETENTION_DAYS} days.`);
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to proceed...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 执行删除
    const startTime = Date.now();
    const result = await prisma.priceRecord.deleteMany({
      where: {
        recordedAt: { lt: cutoffDate },
      },
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Deleted ${result.count.toLocaleString()} records in ${duration}s`);

    // 显示剩余数据统计
    const remaining = await prisma.priceRecord.count();
    console.log(`📊 Remaining records: ${remaining.toLocaleString()}`);

  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

cleanupOldData();
