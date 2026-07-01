import { PrismaClient, Prisma } from '@prisma/client';

export { PrismaClient, Prisma };
export * from '@prisma/client';

let _prisma: PrismaClient | undefined;

/** Lazily-created singleton Prisma client (avoids exhausting connections in dev). */
export function getPrisma(): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient();
  }
  return _prisma;
}
