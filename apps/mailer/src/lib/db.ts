import 'dotenv/config';
import * as schema from '@pcb/db/schema';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL env var is required');
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 10,
});

export const db = drizzle(pool, { schema });
export { pool };
