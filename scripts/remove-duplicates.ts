import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function removeDuplicates() {
  console.log('🔍 Checking for duplicate records...\n');

  try {
    // 查找重复记录
    const duplicates = await prisma.$queryRaw<
      Array<{ itemId: number; recordedAt: Date; count: number }>
    >`
      SELECT itemId, recordedAt, COUNT(*) as count
      FROM PriceRecord
      GROUP BY itemId, recordedAt
      HAVING COUNT(*) > 1
    `;

    if (duplicates.length === 0) {
      console.log('✅ No duplicate records found!');
      return;
    }

    console.log(`⚠️  Found ${duplicates.length} groups of duplicates`);

    let totalDeleted = 0;
    for (const dup of duplicates) {
      // 获取所有重复记录，保留ID最小的那个
      const records = await prisma.priceRecord.findMany({
        where: {
          itemId: dup.itemId,
          recordedAt: dup.recordedAt,
        },
        orderBy: { id: 'asc' },
      });

      if (records.length > 1) {
        // 删除除了第一条之外的所有记录
        const idsToDelete = records.slice(1).map((r) => r.id);

        const result = await prisma.priceRecord.deleteMany({
          where: {
            id: { in: idsToDelete },
          },
        });

        totalDeleted += result.count;
        console.log(`  Cleaned itemId=${dup.itemId}, removed ${result.count} duplicates`);
      }
    }

    console.log(`\n✅ Removed ${totalDeleted} duplicate records`);
    console.log('✅ Now you can safely run: npx prisma db push --accept-data-loss');
  } catch (error) {
    console.error('❌ Failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

removeDuplicates();
