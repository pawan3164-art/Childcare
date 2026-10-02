import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Connects using DATABASE_APP_URL — a restricted Postgres role (no BYPASSRLS,
 * no UPDATE/DELETE on audit_log_entries) created by the enable_rls migration.
 * Schema migrations run separately via DATABASE_URL (the schema-owner role).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      datasourceUrl: process.env.DATABASE_APP_URL ?? process.env.DATABASE_URL,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
