import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function initDb(): Promise<void> {
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector;").catch(() => {
    console.warn("pgvector extension not available — falling back to JSONB embeddings");
  });

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

export async function hasPgvector(): Promise<boolean> {
  try {
    const result = await pool.query(
      "SELECT 1 FROM pg_extension WHERE extname = 'vector'"
    );
    return result.rows.length > 0;
  } catch {
    return false;
  }
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

  // pgvector: add vector column alongside JSONB for fast similarity search
  const hasVec = await hasPgvector();
  if (hasVec) {
    await addCol("memory_objects", "embedding_vec", "vector(1536)");
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_memory_embedding_vec
      ON memory_objects USING ivfflat (embedding_vec vector_cosine_ops)
      WITH (lists = 100);
    `).catch(() => {
      // ivfflat needs at least some rows; create hnsw as fallback
      pool.query(`
        CREATE INDEX IF NOT EXISTS idx_memory_embedding_vec
        ON memory_objects USING hnsw (embedding_vec vector_cosine_ops);
      `).catch(() => {});
    });
  }

  // API keys for authentication
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id BIGSERIAL PRIMARY KEY,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      scopes JSONB NOT NULL DEFAULT '["read","write"]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys (tenant_id);
  `);

  // Webhook events log
  await pool.query(`
    CREATE TABLE IF NOT EXISTS webhook_events (
      id BIGSERIAL PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'github',
      event_type TEXT NOT NULL,
      delivery_id TEXT UNIQUE,
      repo TEXT,
      payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    );
  `);
}
