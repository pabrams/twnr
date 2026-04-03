import { Pool } from 'pg';

export const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'twnr',
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
});
