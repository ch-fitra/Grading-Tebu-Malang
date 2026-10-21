import "./env.js";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL wajib diisi. Data operasional memerlukan PostgreSQL.");
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 10000 });
pool.on("error", () => console.error("Koneksi PostgreSQL terputus; periksa layanan database"));

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
