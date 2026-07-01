import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function generateGatewayKey(): { plaintext: string; hash: string; prefix: string } {
  const raw = randomBytes(24).toString('base64url');
  const plaintext = `sk-rtr-${raw}`;
  const hash = createHash('sha256').update(plaintext).digest('hex');
  const prefix = plaintext.slice(0, 12);
  return { plaintext, hash, prefix };
}

async function main() {
  const user = await prisma.user.upsert({
    where: { email: 'demo@router.dev' },
    update: {},
    create: { email: 'demo@router.dev', name: 'Demo User' },
  });

  const workspace = await prisma.workspace.create({
    data: {
      name: 'Demo Workspace',
      routingWeights: { cost: 1, latency: 0.3, quality: 1.2 },
      members: { create: { userId: user.id, role: 'owner' } },
    },
  });

  const key = generateGatewayKey();
  await prisma.gatewayApiKey.create({
    data: {
      workspaceId: workspace.id,
      name: 'Demo Key',
      keyHash: key.hash,
      keyPrefix: key.prefix,
    },
  });

  console.log('Seed complete.');
  console.log('Workspace:', workspace.id);
  console.log('Gateway API key (store it now, shown once):');
  console.log('  ', key.plaintext);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
