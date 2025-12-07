import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create a default tenant
  const defaultTenant = await prisma.tenant.upsert({
    where: { id: 'default-tenant' },
    update: {},
    create: {
      id: 'default-tenant',
      name: 'Default Tenant',
    },
  });

  console.log('Created default tenant:', defaultTenant);

  // Create a sample device
  const sampleDevice = await prisma.device.upsert({
    where: { id: 'sample-device-001' },
    update: {},
    create: {
      id: 'sample-device-001',
      name: 'Sample Device',
      tenantId: defaultTenant.id,
    },
  });

  console.log('Created sample device:', sampleDevice);

  // Create an audit log entry for seed
  await prisma.auditLog.create({
    data: {
      action: 'SEED_DATABASE',
      actorType: 'system',
      details: { message: 'Database seeded with default tenant and device' },
    },
  });

  console.log('Seed completed successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
