import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import 'dotenv/config';

import * as schema from './schema/index.ts';

export * from './schema/index.ts';

const { Pool } = pg;

/**
 * 数据库连接池（基于 DATABASE_URL）
 * 本地开发：postgresql://user:pass@localhost:5432/pcb_leadgen
 * 生产：从环境变量注入（Supabase / Fly.io）
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;

export { pool };
