import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS raw_prs (
      id BIGSERIAL PRIMARY KEY,
      repo TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      pr_title TEXT NOT NULL,
      pr_body TEXT,
      pr_json JSONB NOT NULL,
      commits_json JSONB NOT NULL,
      files_json JSONB NOT NULL,
      author TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(repo, pr_number)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS memory_objects (
      id TEXT PRIMARY KEY,
      raw_pr_id BIGINT NOT NULL REFERENCES raw_prs(id) ON DELETE CASCADE,
      repo TEXT NOT NULL,
      pr_number INTEGER,
      pr_title TEXT NOT NULL,
      problem TEXT NOT NULL,
      root_cause TEXT,
      fix TEXT NOT NULL,
      reasoning TEXT NOT NULL,
      risk_area TEXT,
      services_affected JSONB,
      summary TEXT,
      files_changed JSONB NOT NULL,
      author TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      embedding JSONB NOT NULL,
      search_vector TSVECTOR,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await upgradeDb();
}

async function upgradeDb(): Promise<void> {
  const addCol = async (table: string, col: string, type: string) => {
    await pool.query(`
      DO $$ BEGIN
        ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} ${type};
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;
    `);
  };

  await addCol("memory_objects", "pr_number", "INTEGER");
  await addCol("memory_objects", "root_cause", "TEXT");
  await addCol("memory_objects", "risk_area", "TEXT");
  await addCol("memory_objects", "services_affected", "JSONB");
  await addCol("memory_objects", "summary", "TEXT");
  await addCol("memory_objects", "search_vector", "TSVECTOR");

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_memory_search_vector
    ON memory_objects USING GIN (search_vector);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS issues (
      id BIGSERIAL PRIMARY KEY,
      repo TEXT NOT NULL,
      issue_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      state TEXT,
      author TEXT,
      labels JSONB,
      created_at TIMESTAMPTZ NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(repo, issue_number)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS issue_pr_links (
      id BIGSERIAL PRIMARY KEY,
      repo TEXT NOT NULL,
      issue_number INTEGER NOT NULL,
      pr_number INTEGER NOT NULL,
      link_type TEXT NOT NULL,
      UNIQUE(repo, issue_number, pr_number)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS entity_aliases (
      id BIGSERIAL PRIMARY KEY,
      canonical TEXT NOT NULL,
      alias TEXT NOT NULL UNIQUE,
      entity_type TEXT NOT NULL DEFAULT 'service'
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_entity_canonical ON entity_aliases (canonical);
  `);
}
