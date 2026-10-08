import "./env.js";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import pg from "pg";

export const PERMISSIONS = ["dashboard.read", "history.read", "inspection.write", "camera.read", "camera.write", "model.read", "model.write", "settings.read", "user.read", "user.write", "role.read", "role.write"] as const;
export type Permission = typeof PERMISSIONS[number];
export type Role = { id: number; code: string; name: string; description: string; permissions: Permission[]; system: boolean };
export type User = { id: number; username: string; roleId: number; role: string; permissions: Permission[]; active: boolean };
type InternalUser = User & { passwordHash: string };

const defaults: Omit<Role, "id">[] = [
  { code: "developer", name: "Developer (Sistem)", description: "Akses penuh platform, sistem AI, dan manajemen multi-pabrik", permissions: [...PERMISSIONS], system: true },
  { code: "admin", name: "Admin (Direksi / Manajemen)", description: "Akses pemantauan direksi, evaluasi mutu, audit laporan, persetujuan 2FA & kelola akun. Dibatasi dari kontrol scan conveyor.", permissions: PERMISSIONS.filter(p => p !== "role.write") as Permission[], system: false },
  { code: "operator", name: "Operator (Operasional Lapangan)", description: "Menjalankan pemindaian meja tebu (Start/Stop Scan), CCTV realtime & rekonsiliasi data. Penghapusan frame wajib persetujuan 2FA direksi.", permissions: ["dashboard.read", "history.read", "inspection.write", "camera.read", "model.read"], system: false },
  { code: "viewer", name: "Viewer (Tamu)", description: "Melihat data operasional dan riwayat", permissions: ["dashboard.read", "history.read", "camera.read", "model.read"], system: false }
];
const roles: Role[] = defaults.map((r, i) => ({ ...r, id: i + 1 }));
const users: InternalUser[] = [];
let nextRoleId = 5, nextUserId = 1;
const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;
let connected = false;
const jwtSecret = process.env.JWT_SECRET ?? "local-development-secret-change-me";
if (process.env.NODE_ENV === "production" && (!process.env.JWT_SECRET || !process.env.APP_DEVELOPER_PASSWORD || !process.env.APP_ADMIN_PASSWORD || !process.env.DATABASE_URL || process.env.DATABASE_REQUIRED !== "true")) {
  throw new Error("Production requires JWT_SECRET, bootstrap passwords, DATABASE_URL, and DATABASE_REQUIRED=true");
}

function hashPassword(password: string) { const salt = randomBytes(16).toString("hex"); return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`; }
function matchesPassword(password: string, hash: string) {
  const [salt, expectedHex] = hash.split(":");
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function roleRow(r: Record<string, unknown>): Role { return { id: Number(r.id), code: String(r.code), name: String(r.name), description: String(r.description ?? ""), permissions: r.permissions as Permission[], system: Boolean(r.system) }; }
function userRow(r: Record<string, unknown>): InternalUser { return { id: Number(r.id), username: String(r.username), roleId: Number(r.role_id), role: String(r.role), permissions: r.permissions as Permission[], active: Boolean(r.active), passwordHash: String(r.password_hash) }; }
function publicUser(u: InternalUser): User { const { passwordHash: _unused, ...safe } = u; return safe; }
function sign(payload: object) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", jwtSecret).update(body).digest("base64url");
  return `${body}.${signature}`;
}
function decode(token: string): { sub: number; exp: number } | null {
  const [body, signature] = token.split("."); if (!body || !signature) return null;
  const expected = createHmac("sha256", jwtSecret).update(body).digest();
  const received = Buffer.from(signature, "base64url");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try { const value = JSON.parse(Buffer.from(body, "base64url").toString()); return Number(value.exp) > Date.now() ? value : null; } catch { return null; }
}
async function bootstrapUser(username: string, password: string, role: string) {
  const r = roles.find(item => item.code === role) || roles[0];
  const existingMem = users.find(u => u.username === username);
  if (!existingMem) {
    users.push({ id: nextUserId++, username, passwordHash: hashPassword(password), roleId: r.id, role: r.code, permissions: r.permissions, active: true });
  } else {
    existingMem.passwordHash = hashPassword(password);
  }
  if (!connected || !pool) return;
  try {
    const found = await pool.query("SELECT id,password_hash FROM app_users WHERE username=$1", [username]);
    if (!found.rowCount) await pool.query("INSERT INTO app_users(username,password_hash,role,role_id) VALUES($1,$2,$3::varchar,(SELECT id FROM roles WHERE code=$3::varchar))", [username, hashPassword(password), role]);
    else if (!String(found.rows[0].password_hash).includes(":")) await pool.query("UPDATE app_users SET password_hash=$2,role=$3,role_id=(SELECT id FROM roles WHERE code=$3) WHERE id=$1", [found.rows[0].id, hashPassword(password), role]);
  } catch {
    // Keep in-memory user active if PostgreSQL is temporarily unreachable
  }
}

export const auth = {
  async initialize() {
    if (!pool) throw new Error("DATABASE_URL wajib diisi. Role dan user hanya boleh memakai PostgreSQL.");
    try {
      await pool.query("SELECT 1 FROM roles LIMIT 1");
      connected = true;
    } catch {
      // Allow fallback in development if DB is starting up
      connected = false;
    }
    const devPass = process.env.APP_DEVELOPER_PASSWORD;
    const adminPass = process.env.APP_ADMIN_PASSWORD;
    const trangkilAdminPass = process.env.PASSWORD_TRANGKIL_ADMIN;
    const trangkilOpPass = process.env.PASSWORD_TRANGKIL_OPERATOR;
    const kebonagungAdminPass = process.env.PASSWORD_KEBONAGUNG_ADMIN;
    const kebonagungOpPass = process.env.PASSWORD_KEBONAGUNG_OPERATOR;

    if (devPass) {
      await bootstrapUser(process.env.APP_DEVELOPER_USER ?? "developer", devPass, "developer");
    }
    if (adminPass) {
      await bootstrapUser(process.env.APP_ADMIN_USER ?? "admin", adminPass, "admin");
    }
    if (trangkilAdminPass) {
      await bootstrapUser(process.env.USER_TRANGKIL_ADMIN ?? "admin_trangkil", trangkilAdminPass, "admin");
    }
    if (trangkilOpPass) {
      await bootstrapUser(process.env.USER_TRANGKIL_OPERATOR ?? "operator_trangkil", trangkilOpPass, "operator");
    }
    if (kebonagungAdminPass) {
      await bootstrapUser(process.env.USER_KEBONAGUNG_ADMIN ?? "admin_kebonagung", kebonagungAdminPass, "admin");
    }
    if (kebonagungOpPass) {
      await bootstrapUser(process.env.USER_KEBONAGUNG_OPERATOR ?? "operator_kebonagung", kebonagungOpPass, "operator");
    }
  },
  async login(username: string, password: string) {
    let u: InternalUser | undefined;
    if (connected && pool) {
      try {
        const res = await pool.query("SELECT u.*,r.code AS role,r.permissions FROM app_users u JOIN roles r ON r.id=u.role_id WHERE u.username=$1", [username]);
        if (res.rowCount) u = userRow(res.rows[0]);
      } catch {
        u = users.find(item => item.username === username);
      }
    } else {
      u = users.find(item => item.username === username);
    }
    if (!u) u = users.find(item => item.username === username);
    if (!u?.active) return null;

    const valid = matchesPassword(password, u.passwordHash);
    if (!valid) return null;
    return { token: sign({ sub: u.id, exp: Date.now() + 8 * 60 * 60 * 1000 }), user: publicUser(u) };
  },
  async verifyAdmin(factory: string, passwordOrPin: string): Promise<User | null> {
    if (!passwordOrPin) return null;
    const allUsers = await auth.listUsers();
    const admins = allUsers.filter(u =>
      u.active &&
      (u.role === "admin" || u.role === "developer") &&
      (factory === "all" || u.username.toLowerCase().includes(factory.toLowerCase()) || u.role === "developer")
    );
    for (const admin of admins) {
      let hash = users.find(u => u.id === admin.id)?.passwordHash;
      if (!hash && connected && pool) {
        try {
          const res = await pool.query("SELECT password_hash FROM app_users WHERE id=$1", [admin.id]);
          if (res.rowCount) hash = String(res.rows[0].password_hash);
        } catch {}
      }
      if (hash && matchesPassword(passwordOrPin, hash)) {
        return admin;
      }
    }
    if (process.env.ADMIN_2FA_PIN && passwordOrPin === process.env.ADMIN_2FA_PIN) {
      const rootAdmin = admins[0];
      if (rootAdmin) return rootAdmin;
    }
    return null;
  },
  async current(token: string) {
    const payload = decode(token); if (!payload) return null;
    let u: InternalUser | undefined;
    if (connected && pool) {
      try {
        const res = await pool.query("SELECT u.*,r.code AS role,r.permissions FROM app_users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1", [payload.sub]);
        if (res.rowCount) u = userRow(res.rows[0]);
      } catch {
        u = users.find(item => item.id === payload.sub);
      }
    } else {
      u = users.find(item => item.id === payload.sub);
    }
    if (!u) u = users.find(item => item.id === payload.sub);
    if (!u?.active) return null;
    if (!connected || !u.permissions) {
      const role = roles.find(r => r.id === u.roleId || r.code === u.role);
      if (role) { u.permissions = role.permissions; u.role = role.code; }
    }
    return publicUser(u);
  },
  async listRoles() { return connected && pool ? (await pool.query("SELECT * FROM roles ORDER BY id")).rows.map(roleRow) : roles; },
  async listVisibleRoles(actor: User) {
    const all = await auth.listRoles();
    return actor.role === "developer" ? all : all.filter(role => role.code !== "developer");
  },
  async createRole(data: Pick<Role, "code" | "name" | "description" | "permissions">) {
    if (connected && pool) return roleRow((await pool.query("INSERT INTO roles(code,name,description,permissions) VALUES($1,$2,$3,$4) RETURNING *", [data.code, data.name, data.description, data.permissions])).rows[0]);
    if (roles.some(r => r.code === data.code)) throw new Error("Role code already exists");
    const r = { ...data, id: nextRoleId++, system: false }; roles.push(r); return r;
  },
  async updateRole(id: number, data: Pick<Role, "name" | "description" | "permissions">) {
    const role = (await auth.listRoles()).find(r => r.id === id); if (!role || role.system) return null;
    if (connected && pool) return roleRow((await pool.query("UPDATE roles SET name=$2,description=$3,permissions=$4 WHERE id=$1 RETURNING *", [id, data.name, data.description, data.permissions])).rows[0]);
    Object.assign(role, data); return role;
  },
  async deleteRole(id: number) {
    const role = (await auth.listRoles()).find(r => r.id === id); if (!role || role.system) return false;
    if (connected && pool) { const result = await pool.query("DELETE FROM roles WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM app_users WHERE role_id=$1)", [id]); return Boolean(result.rowCount); }
    if (users.some(u => u.roleId === id)) return false; roles.splice(roles.indexOf(role), 1); return true;
  },
  async listUsers() {
    if (connected && pool) return (await pool.query("SELECT u.*,r.code AS role,r.permissions FROM app_users u JOIN roles r ON r.id=u.role_id ORDER BY u.id")).rows.map(r => publicUser(userRow(r)));
    return users.map(u => { const role = roles.find(r => r.id === u.roleId); if (role) { u.permissions = role.permissions; u.role = role.code; } return publicUser(u); });
  },
  async createUser(data: { username: string; password: string; roleId: number; active: boolean }) {
    const role = (await auth.listRoles()).find(r => r.id === data.roleId); if (!role) return null;
    if (connected && pool) return publicUser(userRow((await pool.query("WITH inserted AS (INSERT INTO app_users(username,password_hash,role,role_id,active) VALUES($1,$2,$3,$4,$5) RETURNING *) SELECT inserted.*,r.code AS role,r.permissions FROM inserted JOIN roles r ON r.id=inserted.role_id", [data.username, hashPassword(data.password), role.code, role.id, data.active])).rows[0]));
    if (users.some(u => u.username === data.username)) throw new Error("Username already exists");
    const u = { id: nextUserId++, username: data.username, passwordHash: hashPassword(data.password), roleId: role.id, role: role.code, permissions: role.permissions, active: data.active }; users.push(u); return publicUser(u);
  },
  async updateUser(id: number, data: { roleId?: number; active?: boolean; password?: string }) {
    const previous = (await auth.listUsers()).find(u => u.id === id); if (!previous) return null;
    const role = (await auth.listRoles()).find(r => r.id === (data.roleId ?? previous.roleId)); if (!role) return null;
    if (connected && pool) return publicUser(userRow((await pool.query("WITH updated AS (UPDATE app_users SET role_id=$2,role=$3,active=$4,password_hash=COALESCE($5,password_hash),updated_at=NOW() WHERE id=$1 RETURNING *) SELECT updated.*,r.code AS role,r.permissions FROM updated JOIN roles r ON r.id=updated.role_id", [id, role.id, role.code, data.active ?? previous.active, data.password ? hashPassword(data.password) : null])).rows[0]));
    const u = users.find(item => item.id === id)!; u.roleId = role.id; u.role = role.code; u.permissions = role.permissions; u.active = data.active ?? u.active; if (data.password) u.passwordHash = hashPassword(data.password); return publicUser(u);
  }
};
