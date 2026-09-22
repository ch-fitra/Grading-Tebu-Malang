import { useEffect, useState } from "react";
import { Eye, EyeOff, Plus, Shield, Users, Pencil, Power, Trash2, X } from "lucide-react";
import { api } from "../utils/api";
import { useAppStore } from "../store";
import { Header } from "./shared/Header";

type Role = { id: number; code: string; name: string; description: string; permissions: string[]; system: boolean };
type User = { id: number; username: string; roleId: number; role: string; permissions: string[]; active: boolean };
const permissionGroups: Record<string, { value: string; label: string }[]> = {
  Monitoring: [{ value: "dashboard.read", label: "Lihat dashboard" }, { value: "history.read", label: "Lihat riwayat" }],
  Operasional: [{ value: "inspection.write", label: "Jalankan inspeksi" }, { value: "camera.read", label: "Lihat kamera" }, { value: "camera.write", label: "Kelola kamera" }, { value: "model.read", label: "Lihat model AI" }, { value: "model.write", label: "Kelola model AI" }, { value: "settings.read", label: "Lihat pengaturan" }],
  Akses: [{ value: "user.read", label: "Lihat user" }, { value: "user.write", label: "Kelola user" }, { value: "role.read", label: "Lihat role" }, { value: "role.write", label: "Kelola role" }]
};
const restrictedForAdmin = ["user.read", "user.write", "role.read", "role.write", "model.write", "settings.read"];

export function AccessManagement() {
  const session = useAppStore(s => s.session);
  const isDeveloper = session?.user.role === "developer";
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [view, setView] = useState<"users" | "roles">("users");
  const [editingRole, setEditingRole] = useState<Role | "new" | null>(null);
  const [editingUser, setEditingUser] = useState<User | "new" | null>(null);
  const [roleForm, setRoleForm] = useState({ code: "", name: "", description: "", permissions: [] as string[] });
  const [userForm, setUserForm] = useState({ username: "", password: "", roleId: 0, active: true });
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canWriteUsers = session?.user.permissions?.includes("user.write") ?? false;
  const canWriteRoles = session?.user.permissions?.includes("role.write") ?? false;
  const manageableRoles = roles.filter(r => isDeveloper || !r.permissions.some(p => restrictedForAdmin.includes(p)));

  async function reload() {
    const [roleRows, userRows] = await Promise.all([api<Role[]>("/api/roles"), api<User[]>("/api/users")]);
    setRoles(roleRows); setUsers(userRows);
  }
  useEffect(() => { reload().catch(() => setError("Gagal memuat pengguna dan role.")); }, []);
  async function request(action: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await action(); await reload(); setEditingRole(null); setEditingUser(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Operasi gagal"); }
    finally { setBusy(false); }
  }
  function openRole(role?: Role) {
    setRoleForm(role ? { code: role.code, name: role.name, description: role.description, permissions: [...role.permissions] } : { code: "", name: "", description: "", permissions: [] });
    setEditingRole(role ?? "new"); setError("");
  }
  function openUser(user?: User) {
    setUserForm(user ? { username: user.username, password: "", roleId: user.roleId, active: user.active } : { username: "", password: "", roleId: manageableRoles[0]?.id ?? 0, active: true });
    setEditingUser(user ?? "new"); setPasswordVisible(false); setError("");
  }
  async function saveRole(e: React.FormEvent) {
    e.preventDefault();
    if (editingRole === "new") await request(() => api("/api/roles", { method: "POST", body: JSON.stringify(roleForm) }));
    else if (editingRole) await request(() => api(`/api/roles/${editingRole.id}`, { method: "PUT", body: JSON.stringify({ name: roleForm.name, description: roleForm.description, permissions: roleForm.permissions }) }));
  }
  async function saveUser(e: React.FormEvent) {
    e.preventDefault();
    if (editingUser === "new") await request(() => api("/api/users", { method: "POST", body: JSON.stringify(userForm) }));
    else if (editingUser) await request(() => api(`/api/users/${editingUser.id}`, { method: "PATCH", body: JSON.stringify({ roleId: userForm.roleId, active: userForm.active, ...(userForm.password ? { password: userForm.password } : {}) }) }));
  }
  return <div className="accessPage">
    <Header title="Users & Roles" subtitle="Kelola akun dan hak akses untuk seluruh platform" />
    <div className="accessToolbar">
      <div className="accessTabs"><button className={view === "users" ? "selected" : ""} onClick={() => setView("users")}><Users size={16}/> Pengguna</button><button className={view === "roles" ? "selected" : ""} onClick={() => setView("roles")}><Shield size={16}/> Role & Izin</button></div>
      {view === "users" && canWriteUsers && <button className="primary" onClick={() => openUser()}><Plus size={16}/> Tambah User</button>}
      {view === "roles" && canWriteRoles && <button className="primary" onClick={() => openRole()}><Plus size={16}/> Tambah Role</button>}
    </div>
    {error && <p className="accessError" role="alert">{error}</p>}
    {view === "users" ? <div className="accessTableWrap"><table className="accessTable"><thead><tr><th>USERNAME</th><th>ROLE</th><th>STATUS</th><th>AKSI</th></tr></thead><tbody>{users.map(u => <tr key={u.id}><td><strong>{u.username}</strong></td><td>{roles.find(r => r.id === u.roleId)?.name ?? u.role}</td><td><span className={`accessBadge ${u.active ? "good" : "muted"}`}>{u.active ? "AKTIF" : "NONAKTIF"}</span></td><td>{canWriteUsers && <div className="accessActions"><button title="Edit user" onClick={() => openUser(u)}><Pencil size={15}/></button><button title={u.active ? "Nonaktifkan" : "Aktifkan"} disabled={u.id === session?.user.id} onClick={() => request(() => api(`/api/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ active: !u.active }) }))}><Power size={15}/></button></div>}</td></tr>)}</tbody></table></div> : <div className="accessRoleGrid">{roles.map(r => <article className="accessRoleCard" key={r.id}><div className="accessRoleHead"><Shield size={19}/><div><h3>{r.name}</h3><small>{r.code}</small></div><span className={`accessBadge ${r.system ? "muted" : "good"}`}>{r.system ? "SISTEM" : "KUSTOM"}</span></div><p>{r.description}</p><div className="accessPermissionCount">{r.permissions.length} izin aktif</div><div className="accessRoleActions">{canWriteRoles && !r.system && <><button onClick={() => openRole(r)}><Pencil size={15}/> Edit</button><button onClick={() => { if (window.confirm(`Hapus role ${r.name}?`)) request(() => api(`/api/roles/${r.id}`, { method: "DELETE" })); }}><Trash2 size={15}/> Hapus</button></>}</div></article>)}</div>}
    {editingRole && <div className="accessOverlay"><form className="accessModal" onSubmit={saveRole}><div className="accessModalHead"><h2>{editingRole === "new" ? "Tambah Role" : "Edit Role"}</h2><button type="button" onClick={() => setEditingRole(null)}><X size={18}/></button></div><label>Kode role<input required disabled={editingRole !== "new"} pattern="[a-z][a-z0-9_]{2,49}" value={roleForm.code} onChange={e => setRoleForm({ ...roleForm, code: e.target.value.toLowerCase() })}/></label><label>Nama role<input required value={roleForm.name} onChange={e => setRoleForm({ ...roleForm, name: e.target.value })}/></label><label>Deskripsi<input value={roleForm.description} onChange={e => setRoleForm({ ...roleForm, description: e.target.value })}/></label><div className="accessPermissionList">{Object.entries(permissionGroups).map(([group, values]) => <fieldset key={group}><legend>{group}</legend>{values.map(p => <label key={p.value}><input type="checkbox" checked={roleForm.permissions.includes(p.value)} onChange={e => setRoleForm({ ...roleForm, permissions: e.target.checked ? [...roleForm.permissions, p.value] : roleForm.permissions.filter(v => v !== p.value) })}/>{p.label}</label>)}</fieldset>)}</div><button className="primary" disabled={busy}>Simpan Role</button></form></div>}
    {editingUser && <div className="accessOverlay"><form className="accessModal" onSubmit={saveUser}><div className="accessModalHead"><h2>{editingUser === "new" ? "Tambah User" : "Edit User"}</h2><button type="button" onClick={() => setEditingUser(null)}><X size={18}/></button></div><label>Username<input required minLength={3} disabled={editingUser !== "new"} value={userForm.username} onChange={e => setUserForm({ ...userForm, username: e.target.value })}/></label><label>Password {editingUser !== "new" && <small>(kosongkan bila tidak diubah)</small>}<span className="passwordField"><input type={passwordVisible ? "text" : "password"} required={editingUser === "new"} minLength={8} value={userForm.password} onChange={e => setUserForm({ ...userForm, password: e.target.value })}/><button type="button" className="passwordVisibilityButton" onClick={() => setPasswordVisible(visible => !visible)} aria-label={passwordVisible ? "Sembunyikan password" : "Lihat password"} title={passwordVisible ? "Sembunyikan password" : "Lihat password"}>{passwordVisible ? <EyeOff size={18}/> : <Eye size={18}/>}</button></span></label><label>Role<select value={userForm.roleId} onChange={e => setUserForm({ ...userForm, roleId: Number(e.target.value) })}>{manageableRoles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label><label className="accessCheck"><input type="checkbox" checked={userForm.active} onChange={e => setUserForm({ ...userForm, active: e.target.checked })}/> Akun aktif</label><button className="primary" disabled={busy}>Simpan User</button></form></div>}
  </div>;
}
