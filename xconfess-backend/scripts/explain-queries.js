/* Run EXPLAIN ANALYZE for a set of predefined queries against the configured database.
 * Usage: node scripts/explain-queries.js --query=confession_list --limit=100
 * Requires same env as data-source.ts (.env in backend dir)
 */
const { spawnSync } = require('child_process');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const queries = {
  confession_list: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM anonymous_confessions WHERE is_deleted = false AND is_hidden = false AND moderation_status IN ('approved','pending') ORDER BY created_at DESC LIMIT $1;`,
  confession_by_tag: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT c.id FROM anonymous_confessions c INNER JOIN confession_tags ct ON ct.confession_id = c.id INNER JOIN tags t ON t.id = ct.tag_id WHERE t.name = $1 AND c.is_deleted = false ORDER BY c.created_at DESC LIMIT $2;`,
  reports_list: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM reports WHERE status = $1 ORDER BY created_at DESC LIMIT $2;`,
};

const argv = require('minimist')(process.argv.slice(2));
const q = argv.query || 'confession_list';
if (!queries[q]) {
  console.error('Unknown query key. Options:', Object.keys(queries).join(', '));
  process.exit(2);
}

const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

(async () => {
  const client = await pool.connect();
  try {
    let res;
    if (q === 'confession_by_tag') {
      res = await client.query(queries[q], ['test', parseInt(argv.limit || '100', 10)]);
    } else if (q === 'reports_list') {
      res = await client.query(queries[q], ['pending', parseInt(argv.limit || '100', 10)]);
    } else {
      res = await client.query(queries[q], [parseInt(argv.limit || '100', 10)]);
    }
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error('Explain failed:', err.message || err);
  } finally {
    client.release();
    await pool.end();
  }
})();
