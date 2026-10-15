import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const pool = new Pool({ connectionString });
const db = drizzle(pool);

try {
  // 表名/ schema 与 drizzle-kit migrate 的默认值保持一致，两边可互换
  await migrate(db, {
    migrationsFolder: './drizzle',
    migrationsTable: '__drizzle_migrations',
    migrationsSchema: 'drizzle',
  });
  console.log('migrations applied successfully');
} catch (error) {
  // drizzle-kit 0.31.10 的 renderWithTask 会先 process.exit(1)，
  // 导致外层 console.error 永远不执行、错误信息被静默吞掉；
  // 这里直接调用 drizzle-orm migrator，保证失败时错误可见
  console.error('migration failed:');
  console.error(error);
  process.exit(1);
} finally {
  await pool.end();
}
