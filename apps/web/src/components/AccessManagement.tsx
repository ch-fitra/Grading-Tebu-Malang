import { useEffect, useState } from "react";
import { Eye, EyeOff, Plus, Shield, Users, Pencil, Power, X, Crown, Activity, CheckCircle2, ShieldAlert, ShieldCheck, Lock, FileCheck, XCircle, Clock, ChevronLeft, ChevronRight, Search, RefreshCw } from "lucide-react";
import { api } from "../utils/api";
import { useAppStore } from "../store";
import { Header } from "./shared/Header";
import { usePanelSize } from "../hooks/usePanelSize";
import type { DeletionRequest } from "../types";
import "./AccessManagement.css";

type Role = { id: number; code: string; name: string; description: string; permissions: string[]; system: boolean };
type User = { id: number; username: string; roleId: number; role: string; permissions: string[]; active: boolean };

const permissionGroups: Record<string, { value: string; label: string }[]> = {
  Monitoring: [
    { value: "dashboard.read", label: "Lihat dashboard & KPI mutu" }, 
    { value: "history.read", label: "Lihat riwayat siklus & audit" }
  ],
  Operasional: [
    { value: "inspection.write", label: "Jalankan inspeksi & sinkronisasi" }, 
    { value: "camera.read", label: "Lihat CCTV meja tebu" }, 
    { value: "camera.write", label: "Kelola konfigurasi kamera" }, 
    { value: "model.read", label: "Lihat model AI" }, 
    { value: "model.write", label: "Kelola model AI" }, 
    { value: "settings.read", label: "Lihat pengaturan sistem" }
  ],
  Akses: [
    { value: "user.read", label: "Lihat pengguna" }, 
    { value: "user.write", label: "Kelola pengguna" }, 
    { value: "role.read", label: "Lihat role" }, 
    { value: "role.write", label: "Kelola role" }
  ]
};

const restrictedForAdmin = ["role.write", "model.write"];

export function AccessManagement() {
  const session = useAppStore(s => s.session);
  const deletionRequests = useAppStore(s => s.deletionRequests);
  const reviewDeletionRequest = useAppStore(s => s.reviewDeletionRequest);
  const isDeveloper = session?.user.role === "developer";
  const isAdmin = session?.user.role === "admin";

  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [view, setView] = useState<"users" | "roles" | "approvals">("users");
  const [approvalActionMsg, setApprovalActionMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rolePage, setRolePage] = useState(1);
  const [approvalView, setApprovalView] = useState<"pending" | "history">("pending");
  const [selectedRequest, setSelectedRequest] = useState<DeletionRequest | null>(null);
  const bodySize = usePanelSize<HTMLDivElement>();

  const pendingRequests = deletionRequests.filter(r => r.status === "pending");
  const historyRequests = deletionRequests.filter(r => r.status !== "pending");
  const [editingRole, setEditingRole] = useState<Role | "new" | null>(null);
  const [editingUser, setEditingUser] = useState<User | "new" | null>(null);
  const [roleForm, setRoleForm] = useState({ code: "", name: "", description: "", permissions: [] as string[] });
  const [userForm, setUserForm] = useState({ username: "", password: "", roleId: 0, active: true });
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState("");
  const [successInfo, setSuccessInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const canWriteUsers = session?.user.permissions?.includes("user.write") ?? false;
  const canWriteRoles = session?.user.permissions?.includes("role.write") ?? false;
  const manageableRoles = roles.filter(r => isDeveloper || !r.permissions.some(p => restrictedForAdmin.includes(p)));

  async function reload() {
    setLoading(true);
    try {
      const [roleRows, userRows] = await Promise.all([
        session?.user.permissions.includes("role.read") ? api<Role[]>("/api/roles") : Promise.resolve([]),
        api<User[]>("/api/users")
      ]);
      setRoles(roleRows);
      setUsers(userRows);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload().catch(e => setError(e instanceof Error ? e.message : "Gagal memuat pengguna dan role."));
  }, []);

  async function request(action: () => Promise<unknown>) {
    setBusy(true); 
    setError("");
    setSuccessInfo("");
    try { 
      await action(); 
      await reload(); 
      setEditingRole(null); 
      setEditingUser(null);
      setSuccessInfo("Perubahan berhasil disimpan.");
    } catch (e) { 
      setError(e instanceof Error ? e.message : "Operasi gagal"); 
    } finally { 
      setBusy(false); 
    }
  }

  function openRole(role?: Role) {
    setRoleForm(role ? { code: role.code, name: role.name, description: role.description, permissions: [...role.permissions] } : { code: "", name: "", description: "", permissions: [] });
    setEditingRole(role ?? "new"); 
    setError("");
  }

  function openUser(user?: User) {
    setUserForm(user ? { username: user.username, password: "", roleId: user.roleId, active: user.active } : { username: "", password: "", roleId: manageableRoles[0]?.id ?? 0, active: true });
    setEditingUser(user ?? "new"); 
    setPasswordVisible(false); 
    setError("");
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


  const filteredUsers = users.filter(user => `${user.username} ${user.role}`.toLowerCase().includes(search.toLowerCase()));
  const allPermissions = Object.entries(permissionGroups).flatMap(([group, values]) => values.map(item => ({ ...item, group })));
  const permissionRows = allPermissions.filter(item => `${item.label} ${item.group}`.toLowerCase().includes(search.toLowerCase()));
  const requestRows = (approvalView === "pending" ? pendingRequests : historyRequests).filter(item => `${item.targetTitle} ${item.requestedBy} ${item.reason}`.toLowerCase().includes(search.toLowerCase()));
  const rowHeight = view === "users" ? 86 : view === "roles" ? 44 : 112;
  const pageSize = Math.max(1, Math.floor((bodySize.height - (view === "roles" ? 64 : view === "users" ? 44 : 0) - 1) / rowHeight));
  const totalRows = view === "users" ? filteredUsers.length : view === "roles" ? permissionRows.length : requestRows.length;
  const pages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, pages);
  const offset = (currentPage - 1) * pageSize;
  const roleColumns = bodySize.width >= 1120 ? 4 : bodySize.width >= 700 ? 3 : 2;
  const rolePages = Math.max(1, Math.ceil(roles.length / roleColumns));
  const currentRolePage = Math.min(rolePage, rolePages);
  const visibleRoles = roles.slice((currentRolePage - 1) * roleColumns, currentRolePage * roleColumns);
  const roleLabel = (code: string) => roles.find(role => role.code === code)?.name ?? code;
  const changeView = (next: typeof view) => { setView(next); setSearch(""); setPage(1); };
  const message = approvalActionMsg || successInfo;
  const userRoles = manageableRoles.some(role => role.id === userForm.roleId) ? manageableRoles : [...manageableRoles, ...roles.filter(role => role.id === userForm.roleId)];

  async function review(decision: "approved" | "rejected") {
    if (!selectedRequest) return;
    setBusy(true); setError("");
    try {
      await reviewDeletionRequest(selectedRequest.id, decision, decision === "approved" ? "Disetujui oleh Direksi" : "Ditolak oleh Direksi");
      setApprovalActionMsg(decision === "approved" ? "Permohonan disetujui dan data telah dihapus." : "Permohonan ditolak.");
      setSelectedRequest(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Permohonan gagal ditinjau."); }
    finally { setBusy(false); }
  }

  const userAccess = (user: User) => {
    const labels = [
      user.permissions.includes("dashboard.read") && "Dashboard",
      user.permissions.includes("history.read") && "Riwayat",
      user.permissions.includes("camera.read") && "CCTV",
      user.permissions.includes("inspection.write") && user.role !== "admin" && "Inspeksi",
      user.permissions.includes("user.write") && "Kelola pengguna",
    ].filter(Boolean);
    return [labels.join(", ") || "Hak akses sesuai konfigurasi role", user.role === "admin" ? "Kontrol Start/Stop dibatasi" : user.role === "operator" ? "Penghapusan melalui persetujuan Direksi" : `${user.permissions.length} izin aktif; lihat rincian pada matriks`];
  };

  return (
    <section className="rolesWorkspace fixedWorkspace">
      <Header title="Users & Roles" subtitle="PT Kebon Agung · Unit PG Kebon Agung, Malang" action={
        view === "users" && canWriteUsers ? <button className="workspacePrimary" disabled={busy} onClick={() => openUser()}><Plus size={16} />Tambah User</button>
        : view === "roles" && canWriteRoles ? <button className="workspacePrimary" disabled={busy} onClick={() => openRole()}><Plus size={16} />Tambah Role</button> : undefined
      } />
      <div className="workspaceStats rolesSummary">
        <span className="workspacePill"><Users size={16} /><strong>{users.length}</strong>Pengguna</span>
        <span className="workspacePill"><CheckCircle2 size={16} /><strong>{users.filter(user => user.active).length}</strong>Aktif</span>
        <span className="workspacePill"><Shield size={16} /><strong>{roles.length}</strong>Role</span>
        <span className="workspacePill"><Clock size={16} /><strong>{pendingRequests.length}</strong>Menunggu</span>
        <p><ShieldCheck size={14} /> Operator menjalankan inspeksi. Direksi meninjau penghapusan.</p>
      </div>
      <nav className="rolesTabs" aria-label="Pengelolaan akses">
        <button aria-current={view === "users" ? "page" : undefined} className={view === "users" ? "selected" : ""} onClick={() => changeView("users")}><Users size={15} />Pengguna Pabrik</button>
        <button aria-current={view === "roles" ? "page" : undefined} className={view === "roles" ? "selected" : ""} onClick={() => changeView("roles")}><Shield size={15} />Matriks Hak Akses</button>
        <button aria-current={view === "approvals" ? "page" : undefined} className={view === "approvals" ? "selected" : ""} onClick={() => changeView("approvals")}><ShieldAlert size={15} />Persetujuan Hapus{pendingRequests.length > 0 && <span>{pendingRequests.length}</span>}</button>
      </nav>
      {error && !editingUser && !editingRole && !selectedRequest && <div className="workspaceNotice error" role="alert"><span>{error}</span><button className="workspaceIcon" aria-label="Tutup pesan kesalahan" onClick={() => setError("")}><X size={15} /></button></div>}
      {message && <div className="workspaceNotice" role="status"><CheckCircle2 size={16} /><span>{message}</span><button className="workspaceIcon" aria-label="Tutup pemberitahuan" onClick={() => { setSuccessInfo(""); setApprovalActionMsg(null); }}><X size={15} /></button></div>}
      <div className="rolesPanel">
        <div className="rolesPanelHead">
          {view === "approvals" ? <div className="rolesRequestTabs"><button className={approvalView === "pending" ? "selected" : ""} onClick={() => { setApprovalView("pending"); setPage(1); }}>Menunggu ({pendingRequests.length})</button><button className={approvalView === "history" ? "selected" : ""} onClick={() => { setApprovalView("history"); setPage(1); }}>Riwayat ({historyRequests.length})</button></div>
            : <h2>{view === "users" ? "Daftar Pengguna" : "Matriks Izin Role"}<span>{view === "users" ? users.length : roles.length}</span></h2>}
          <div className="rolesPanelTools">
            {view === "roles" && rolePages > 1 && <div className="workspacePagination"><button className="workspaceIcon" aria-label="Role sebelumnya" disabled={currentRolePage === 1} onClick={() => setRolePage(currentRolePage - 1)}><ChevronLeft size={15} /></button><span>Role {currentRolePage}/{rolePages}</span><button className="workspaceIcon" aria-label="Role berikutnya" disabled={currentRolePage === rolePages} onClick={() => setRolePage(currentRolePage + 1)}><ChevronRight size={15} /></button></div>}
            <label className="rolesSearch"><Search size={15} /><input aria-label={view === "users" ? "Cari pengguna" : view === "roles" ? "Cari izin" : "Cari permohonan"} placeholder={view === "users" ? "Cari pengguna atau role..." : view === "roles" ? "Cari izin..." : "Cari permohonan..."} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
            <button className="workspaceIcon" aria-label="Muat ulang pengguna dan role" disabled={busy || loading} onClick={() => void reload().catch(failure => setError(String(failure)))}><RefreshCw size={16} /></button>
          </div>
        </div>
        <div ref={bodySize.ref} className="rolesBody" data-view={view}>
          {view === "users" ? <table className="rolesUserTable"><thead><tr><th>Pengguna</th><th>Role</th><th>Hak Akses Operasional</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
            {filteredUsers.slice(offset, offset + pageSize).map(user => <tr key={user.id} className={user.id === session?.user.id ? "current" : ""}>
              <td><div className="rolesUserIdentity"><div className={`rolesAvatar ${user.role}`}>{user.role === "admin" ? <Crown size={18} /> : user.role === "operator" ? <Activity size={18} /> : <Shield size={18} />}</div><div><strong title={user.username}>{user.username}</strong><small>{user.id === session?.user.id ? "Akun Anda - " : ""}PG Kebon Agung</small></div></div></td>
              <td><span className={`rolesBadge ${user.role}`}>{roleLabel(user.role)}</span></td>
              <td><div className="rolesUserAccess"><span><CheckCircle2 size={12} />{userAccess(user)[0]}</span><small><Lock size={11} />{userAccess(user)[1]}</small></div></td>
              <td><span className={`rolesStatus ${user.active ? "active" : ""}`}><i />{user.active ? "Aktif" : "Nonaktif"}</span></td>
              <td><div className="rolesActions">{canWriteUsers && <><button className="workspaceIcon" aria-label={`Edit user ${user.username}`} title="Edit user" disabled={busy} onClick={() => openUser(user)}><Pencil size={15} /></button><button className="workspaceIcon" aria-label={`${user.active ? "Nonaktifkan" : "Aktifkan"} akun ${user.username}`} title={user.active ? "Nonaktifkan akun" : "Aktifkan akun"} disabled={busy || user.id === session?.user.id} onClick={() => void request(() => api(`/api/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ active: !user.active }) }))}><Power size={15} /></button></>}</div></td>
            </tr>)}
          </tbody></table> : view === "roles" ? <table className="rolesMatrix"><thead><tr><th>Hak Akses</th>{visibleRoles.map(role => <th key={role.id}><div><strong title={role.name}>{role.name}</strong>{canWriteRoles && !role.system && <button className="workspaceIcon" aria-label={`Edit role ${role.name}`} title="Edit role" disabled={busy} onClick={() => openRole(role)}><Pencil size={13} /></button>}</div><small>{users.filter(user => user.roleId === role.id).length} pengguna</small></th>)}</tr></thead><tbody>
            {permissionRows.slice(offset, offset + pageSize).map(permission => <tr key={permission.value}><td><strong>{permission.label}</strong><small>{permission.group}</small></td>{visibleRoles.map(role => <td key={role.id}>{role.permissions.includes(permission.value) ? role.code === "admin" && permission.value === "inspection.write" ? <span className="rolesPermission limited" title="Sinkronisasi diizinkan; kontrol Start/Stop dibatasi"><ShieldAlert size={16} /><small>Start/Stop dibatasi</small></span> : <span className="rolesPermission allowed" aria-label="Diizinkan"><CheckCircle2 size={17} /></span> : <span className="rolesPermission denied" aria-label="Tidak diberikan"><XCircle size={17} /></span>}</td>)}</tr>)}
          </tbody></table> : <div className="rolesRequestList">{requestRows.slice(offset, offset + pageSize).map(item => <article key={item.id} className="rolesRequest"><div className={`rolesRequestIcon ${item.status}`}><FileCheck size={20} /></div><div className="rolesRequestInfo"><strong title={item.targetTitle}>{item.targetTitle}</strong><span>{item.requestedBy} - {new Date(item.requestedAt).toLocaleString("id-ID")}</span><p title={item.reason}>{item.reason}</p></div><span className={`rolesStatus ${item.status === "approved" ? "active" : item.status === "pending" ? "pending" : ""}`}>{item.status === "pending" ? "Menunggu" : item.status === "approved" ? "Disetujui" : "Ditolak"}</span><button className="workspaceSecondary" onClick={() => { setSelectedRequest(item); setError(""); }}>Lihat Detail</button></article>)}</div>}
          {!totalRows && <div className="workspaceEmpty"><ShieldCheck size={30} /><strong>{loading ? "Memuat data..." : search ? "Tidak ada hasil pencarian" : view === "approvals" ? approvalView === "pending" ? "Tidak ada permohonan menunggu" : "Belum ada riwayat keputusan" : "Belum ada data"}</strong><span>{view === "approvals" ? "Permohonan penghapusan ditinjau oleh Direksi sebelum diproses." : "Data akan tampil setelah tersedia pada instalasi PG Kebon Agung."}</span></div>}
        </div>
        <footer className="workspaceFooter"><span>{totalRows ? `${offset + 1}-${Math.min(offset + pageSize, totalRows)} dari ${totalRows} ${view === "users" ? "pengguna" : view === "roles" ? "izin" : "permohonan"}` : "0 data"}{view === "roles" && <small className="rolesMatrixNote">Izin mengikuti konfigurasi role. Kontrol inspeksi juga mengikuti pembatasan peran.</small>}</span><nav className="workspacePagination" aria-label="Halaman pengelolaan akses"><button className="workspaceIcon" aria-label="Halaman akses sebelumnya" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button><span aria-live="polite">{currentPage} / {pages}</span><button className="workspaceIcon" aria-label="Halaman akses berikutnya" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button></nav></footer>
      </div>
      {editingRole && <div className="workspaceOverlay"><form className="workspaceDialog rolesRoleDialog" role="dialog" aria-modal="true" aria-labelledby="roles-dialog-title" onSubmit={saveRole}><div className="workspaceDialogHead"><div><h2 id="roles-dialog-title">{editingRole === "new" ? "Tambah Role" : "Edit Role"}</h2><p>Atur nama dan izin untuk role PG Kebon Agung.</p></div><button type="button" className="workspaceIcon" aria-label="Tutup formulir role" disabled={busy} onClick={() => setEditingRole(null)}><X size={18} /></button></div>
        <div className="rolesFormRow"><label>Kode role<input required disabled={editingRole !== "new"} pattern="[a-z][a-z0-9_]{2,49}" value={roleForm.code} onChange={event => setRoleForm({ ...roleForm, code: event.target.value.toLowerCase() })} /></label><label>Nama role<input required value={roleForm.name} onChange={event => setRoleForm({ ...roleForm, name: event.target.value })} /></label></div>
        <label>Deskripsi<input value={roleForm.description} onChange={event => setRoleForm({ ...roleForm, description: event.target.value })} /></label>
        <div className="rolesPermissionEditor">{Object.entries(permissionGroups).map(([group, permissions]) => <fieldset key={group}><legend>{group}</legend>{permissions.map(permission => <label className="workspaceCheck" key={permission.value}><input type="checkbox" checked={roleForm.permissions.includes(permission.value)} onChange={event => setRoleForm({ ...roleForm, permissions: event.target.checked ? [...roleForm.permissions, permission.value] : roleForm.permissions.filter(value => value !== permission.value) })} />{permission.label}</label>)}</fieldset>)}</div>
        {error && <div className="workspaceNotice error" role="alert">{error}</div>}<div className="workspaceDialogFooter"><button type="button" className="workspaceSecondary" disabled={busy} onClick={() => setEditingRole(null)}>Batal</button><button className="workspacePrimary" disabled={busy}>{busy ? "Menyimpan..." : "Simpan Role"}</button></div>
      </form></div>}
      {editingUser && <div className="workspaceOverlay"><form className="workspaceDialog" role="dialog" aria-modal="true" aria-labelledby="user-dialog-title" onSubmit={saveUser}><div className="workspaceDialogHead"><div><h2 id="user-dialog-title">{editingUser === "new" ? "Tambah User" : "Edit User"}</h2><p>Pengguna operasional PG Kebon Agung.</p></div><button type="button" className="workspaceIcon" aria-label="Tutup formulir pengguna" disabled={busy} onClick={() => setEditingUser(null)}><X size={18} /></button></div>
        <label>Username<input autoFocus required minLength={3} disabled={editingUser !== "new"} value={userForm.username} onChange={event => setUserForm({ ...userForm, username: event.target.value })} /></label>
        <label>Password {editingUser !== "new" && <small>(kosongkan bila tidak diubah)</small>}<span className="rolesPassword"><input type={passwordVisible ? "text" : "password"} required={editingUser === "new"} minLength={8} value={userForm.password} onChange={event => setUserForm({ ...userForm, password: event.target.value })} /><button type="button" className="workspaceIcon" aria-label={passwordVisible ? "Sembunyikan password" : "Lihat password"} onClick={() => setPasswordVisible(!passwordVisible)}>{passwordVisible ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></label>
        <label>Role<select required value={userForm.roleId} onChange={event => setUserForm({ ...userForm, roleId: Number(event.target.value) })}>{userRoles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
        <label className="workspaceCheck"><input type="checkbox" checked={userForm.active} onChange={event => setUserForm({ ...userForm, active: event.target.checked })} />Akun aktif</label>
        {error && <div className="workspaceNotice error" role="alert">{error}</div>}<div className="workspaceDialogFooter"><button type="button" className="workspaceSecondary" disabled={busy} onClick={() => setEditingUser(null)}>Batal</button><button className="workspacePrimary" disabled={busy}>{busy ? "Menyimpan..." : "Simpan User"}</button></div>
      </form></div>}
      {selectedRequest && <div className="workspaceOverlay"><div className="workspaceDialog" role="dialog" aria-modal="true" aria-labelledby="request-dialog-title"><div className="workspaceDialogHead"><div><h2 id="request-dialog-title">Detail Permohonan</h2><p>{selectedRequest.status === "pending" ? "Tinjau alasan sebelum memutuskan penghapusan." : "Riwayat keputusan penghapusan."}</p></div><button className="workspaceIcon" aria-label="Tutup detail permohonan" disabled={busy} onClick={() => setSelectedRequest(null)}><X size={18} /></button></div>
        <dl className="rolesRequestDetail"><dt>Data</dt><dd>{selectedRequest.targetTitle}</dd>{selectedRequest.targetSubtitle && <><dt>Keterangan</dt><dd>{selectedRequest.targetSubtitle}</dd></>}<dt>Diajukan oleh</dt><dd>{selectedRequest.requestedBy} - {new Date(selectedRequest.requestedAt).toLocaleString("id-ID")}</dd><dt>Alasan</dt><dd>{selectedRequest.reason}</dd>{selectedRequest.notes && <><dt>Catatan</dt><dd>{selectedRequest.notes}</dd></>}{selectedRequest.reviewedBy && <><dt>Keputusan</dt><dd>{selectedRequest.status === "approved" ? "Disetujui" : "Ditolak"} oleh {selectedRequest.reviewedBy}</dd></>}{selectedRequest.reviewNotes && <><dt>Catatan peninjau</dt><dd>{selectedRequest.reviewNotes}</dd></>}</dl>
        {error && <div className="workspaceNotice error" role="alert">{error}</div>}{selectedRequest.status === "pending" && (isAdmin || isDeveloper) && <div className="workspaceDialogFooter"><button className="workspaceSecondary" disabled={busy} onClick={() => void review("rejected")}><XCircle size={15} />Tolak</button><button className="workspacePrimary danger" disabled={busy} onClick={() => void review("approved")}><FileCheck size={15} />Setujui & Hapus</button></div>}
      </div></div>}
    </section>
  );
}
