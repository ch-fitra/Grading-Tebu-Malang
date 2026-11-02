import "./env.js";
import fs from "node:fs/promises";
import pg from "pg";
import { fileURLToPath } from "node:url";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  for (const file of ["001_initial.sql", "002_rbac.sql", "003_role_visibility.sql", "004_active_truck_line.sql", "005_deletion_requests.sql", "006_impurity_measurement.sql", "007_camera_configuration.sql", "008_malang_model.sql"]) {
    const sql = await fs.readFile(fileURLToPath(new URL(`../../../database/postgres/${file}`, import.meta.url)), "utf8");
    await pool.query(sql);
  }
  console.log("PostgreSQL migration completed.");
} finally {
  await pool.end();
}
