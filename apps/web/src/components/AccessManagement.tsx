import { useEffect, useState } from "react";
import { Eye, EyeOff, Plus, Shield, Users, Pencil, Power, Trash2, X, Crown, Activity, CheckCircle2, ShieldAlert, ShieldCheck, Lock, FileSpreadsheet, FileCheck, XCircle, Clock } from "lucide-react";
import { api } from "../utils/api";
import { useAppStore } from "../store";
import { Header } from "./shared/Header";

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
  const [reviewNotesInput, setReviewNotesInput] = useState<Record<string, string>>({});
  const [approvalActionMsg, setApprovalActionMsg] = useState<string | null>(null);

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

  const currentUserFactory = (() => {
    const u = (session?.user.username || "").toLowerCase();
    if (u.includes("kebonagung") || u.includes("malang")) return "PG Kebon Agung (Malang)";
    if (u.includes("trangkil")) return "PG Trangkil (Pati)";
    return "Multi-Pabrik";
  })();

  function resolveUserMeta(username: string, roleCode: string) {
    const u = username.toLowerCase();
    const isTrangkil = u.includes("trangkil");
    const isKebonagung = u.includes("kebonagung") || u.includes("malang");
    const factoryName = isTrangkil ? "PG Trangkil (Pati)" : isKebonagung ? "PG Kebon Agung (Malang)" : "Sistem Global";
    
    let displayName = username;
    let badgeType: "admin" | "operator" | "dev" = "dev";
    
    if (roleCode === "admin" || u.includes("admin")) {
      badgeType = "admin";
      displayName = isTrangkil ? "Direksi / Manajemen PT Trangkil" : isKebonagung ? "Direksi / Manajemen PG Kebon Agung" : "Administrator Direksi";
    } else if (roleCode === "operator" || u.includes("operator")) {
      badgeType = "operator";
      displayName = isTrangkil ? "Operator Lapangan MBS 5 (PT Trangkil)" : isKebonagung ? "Operator Lapangan MBS 1 (PG Kebon Agung)" : "Operator Meja Tebu";
    } else {
      displayName = "Super Admin Developer";
    }

    return { factoryName, displayName, badgeType };
  }

  return (
    <div className="accessPage">
      <Header 
        title="Users & Roles" 
        subtitle="Kelola 2 akun resmi setiap Pabrik Gula: Akun Direksi (Admin) & Akun Operator Lapangan beserta batasan hak akses" 
      />

      {/* Role Architecture Context Card */}
      <div className="accessPolicyBanner">
        <div className="policyBannerHead">
          <div className="policyIconBox">
            <ShieldCheck size={20} className="policyIcon" />
          </div>
          <div className="policyHeadContent">
            <div className="policyBadgeRow">
              <span className="policyBadgeTitle">
                <ShieldCheck size={12} />
                <span>STANDAR DUA AKUN RESMI PABRIK GULA ({currentUserFactory})</span>
              </span>
              <span className="policyStandardTag">SOP Audit Mutu Terintegrasi</span>
            </div>
            <p className="policyDescText">
              Sistem membatasi setiap Pabrik Gula hanya memiliki <strong>2 Akun Resmi</strong> dengan pemisahan tugas yang tegas: <strong>Akun Direksi (Admin)</strong> berwenang penuh mengevaluasi mutu, memeriksa laporan SPAT, serta menjadi otorisator <em>2FA Approval (Checker)</em>; sedangkan <strong>Akun Operator</strong> memegang kendali fisik pemindaian conveyor meja tebu dan pengawasan CCTV <em>(Maker)</em> tanpa akses hapus sepihak.
            </p>
          </div>
        </div>

        {/* Dual Role Executive Summary */}
        <div className="policyRolesSummaryGrid">
          <div className="policyRoleMiniCard admin">
            <div className="policyMiniAvatar admin">
              <Crown size={16} />
            </div>
            <div className="policyMiniBody">
              <div className="policyMiniTitleRow">
                <strong>Akun Direksi (Admin)</strong>
                <span className="policyRoleMiniTag admin">Checker & Otorisator</span>
              </div>
              <p>Monitoring KPI mutu, evaluasi 7 kelas label SPAT, persetujuan penghapusan frame. <em>(Dibatasi dari Start/Stop conveyor)</em>.</p>
            </div>
          </div>

          <div className="policyRoleMiniCard operator">
            <div className="policyMiniAvatar operator">
              <Activity size={16} />
            </div>
            <div className="policyMiniBody">
              <div className="policyMiniTitleRow">
                <strong>Akun Operator (Lapangan)</strong>
                <span className="policyRoleMiniTag operator">Maker Lapangan</span>
              </div>
              <p>Pengendali pemindaian conveyor MBS (Start/Stop scan), monitor CCTV meja tebu realtime. <em>(Wajib persetujuan Direksi untuk hapus data)</em>.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs Toolbar */}
      <div className="accessToolbar">
        <div className="accessTabs">
          <button 
            type="button"
            className={view === "users" ? "selected" : ""} 
            onClick={() => setView("users")}
          >
            <Users size={15}/> 
            <span>Pengguna Pabrik ({users.length})</span>
          </button>
          <button 
            type="button"
            className={view === "roles" ? "selected" : ""} 
            onClick={() => setView("roles")}
          >
            <Shield size={15}/> 
            <span>Matriks Role & Batasan Akses</span>
          </button>
          <button 
            type="button"
            className={view === "approvals" ? "selected" : ""} 
            onClick={() => setView("approvals")}
          >
            <ShieldAlert size={15}/> 
            <span>Antrean Persetujuan Hapus</span>
            {pendingRequests.length > 0 && (
              <span className="approvalTabBadge">
                {pendingRequests.length}
              </span>
            )}
          </button>
        </div>

        <div className="accessToolbarActions">
          {view === "users" && canWriteUsers && (
            <button type="button" className="accessPrimaryBtn" onClick={() => openUser()}>
              <Plus size={15}/> 
              <span>Tambah User</span>
            </button>
          )}
          {view === "roles" && canWriteRoles && (
            <button type="button" className="accessPrimaryBtn" onClick={() => openRole()}>
              <Plus size={15}/> 
              <span>Tambah Role</span>
            </button>
          )}
        </div>
      </div>

      {error && <p className="accessError" role="alert">{error}</p>}
      {successInfo && (
        <div className="accessSuccessAlert">
          <CheckCircle2 size={16} />
          <span>{successInfo}</span>
        </div>
      )}

      {view === "users" ? (
        <div className="accessMainCard">
          <div className="accessCardHeader">
            <div className="accessCardTitleGroup">
              <div className="accessCardTitleBadge">
                <Users size={12} />
                <span>DAFTAR PENGGUNA RESMI PABRIK GULA</span>
              </div>
              <span className="accessCardSubtitle">
                Akun pengguna untuk operasional penimbangan, penilaian mutu conveyor, dan otorisasi
              </span>
            </div>
            <div className="accessCardMetaBadge">
              <span className="accessDotLive" />
              <span>SOP Maker-Checker Aktif</span>
            </div>
          </div>

          <div className="accessTableWrap">
            <table className="accessTable enhancedTable">
              <thead>
                <tr>
                  <th>PENGGUNA & PABRIK</th>
                  <th>PERAN (ROLE)</th>
                  <th>BATASAN & HAK AKSES OPERASIONAL</th>
                  <th>STATUS</th>
                  <th>AKSI</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td data-label="Pengguna" colSpan={5} className="accessEmptyCell">
                      {loading ? "Memuat data pengguna resmi pabrik..." : "Belum ada pengguna yang dapat ditampilkan."}
                    </td>
                  </tr>
                ) : (
                  users.map(u => {
                    const meta = resolveUserMeta(u.username, u.role);
                    const isCurrentSessionUser = u.username === session?.user.username;
                    
                    return (
                      <tr key={u.id} className={isCurrentSessionUser ? "rowCurrentActive" : ""}>
                        {/* Column 1: Pengguna & Pabrik */}
                        <td data-label="Pengguna">
                          <div className="userMetaCell">
                            <div className={`userAvatarPill ${meta.badgeType}`}>
                              {meta.badgeType === "admin" ? <Crown size={18} /> : meta.badgeType === "operator" ? <Activity size={18} /> : <Shield size={18} />}
                            </div>
                            <div className="userMetaInfo">
                              <div className="userNameRow">
                                <strong>{u.username}</strong>
                                {isCurrentSessionUser && <span className="currentBadge">Akun Anda</span>}
                              </div>
                              <span className="userSubTitle">{meta.displayName}</span>
                              <span className="userFactoryTag">{meta.factoryName}</span>
                            </div>
                          </div>
                        </td>

                        {/* Column 2: Peran */}
                        <td data-label="Role">
                          {meta.badgeType === "admin" ? (
                            <div className="roleTagBox admin">
                              <Crown size={13} />
                              <span>Admin Direksi</span>
                            </div>
                          ) : meta.badgeType === "operator" ? (
                            <div className="roleTagBox operator">
                              <Activity size={13} />
                              <span>Operator Lapangan</span>
                            </div>
                          ) : (
                            <div className="roleTagBox dev">
                              <Shield size={13} />
                              <span>Developer</span>
                            </div>
                          )}
                        </td>

                        {/* Column 3: Batasan Akses */}
                        <td data-label="Hak akses">
                          <div className="policyGuardrails">
                            {meta.badgeType === "admin" ? (
                              <>
                                <div className="guardrailItem locked">
                                  <Lock size={12} className="iconRed" />
                                  <span><strong>Dibatasi:</strong> Tidak bisa Start / Stop Scan conveyor</span>
                                </div>
                                <div className="guardrailItem allowed">
                                  <CheckCircle2 size={12} className="iconGreen" />
                                  <span><strong>Akses Penuh:</strong> Dashboard Mutu, Laporan SPAT & 2FA Approval</span>
                                </div>
                              </>
                            ) : meta.badgeType === "operator" ? (
                              <>
                                <div className="guardrailItem allowed">
                                  <CheckCircle2 size={12} className="iconGreen" />
                                  <span><strong>Operasional Aktif:</strong> Start / Stop Scan Meja Tebu, CCTV realtime</span>
                                </div>
                                <div className="guardrailItem locked">
                                  <Lock size={12} className="iconAmber" />
                                  <span><strong>Dibatasi:</strong> Hapus Frame wajib 2nd Authenticator Direksi</span>
                                </div>
                              </>
                            ) : (
                              <div className="guardrailItem allowed">
                                <CheckCircle2 size={12} className="iconGreen" />
                                <span>Akses Penuh Seluruh Sistem & Konfigurasi AI</span>
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Column 4: Status */}
                        <td data-label="Status">
                          <span className={`accessBadge ${u.active ? "good" : "muted"}`}>
                            {u.active ? "AKTIF" : "NONAKTIF"}
                          </span>
                        </td>

                        {/* Column 5: Aksi */}
                        <td data-label="Aksi">
                          <div className="accessActions">
                            {canWriteUsers && (
                              <>
                                <button type="button" title="Edit user" className="accessActionBtn" onClick={() => openUser(u)}>
                                  <Pencil size={14}/>
                                </button>
                                <button 
                                  type="button" 
                                  className={`accessActionBtn power ${u.active ? "active" : ""}`}
                                  title={u.active ? "Nonaktifkan akun" : "Aktifkan akun"} 
                                  disabled={u.id === session?.user.id} 
                                  onClick={() => request(() => api(`/api/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ active: !u.active }) }))}
                                >
                                  <Power size={14}/>
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : view === "roles" ? (
        <div className="accessMainCard">
          <div className="accessCardHeader">
            <div className="accessCardTitleGroup">
              <div className="accessCardTitleBadge">
                <Shield size={12} />
                <span>MATRIKS ROLE & BATASAN WEWENANG OPERASIONAL</span>
              </div>
              <span className="accessCardSubtitle">
                Struktur hierarki izin platform Tebu AI untuk menjaga segregasi tugas dan kepatuhan audit pabrik
              </span>
            </div>
            <div className="accessCardMetaBadge">
              <span className="accessDotLive" />
              <span>3 Peran Ditetapkan</span>
            </div>
          </div>

          <div className="accessRoleGrid enhancedRoleGrid">
            {/* Card 1: Admin Direksi */}
            <article className="accessRoleCard highlightAdmin">
              <div className="accessRoleCardBanner admin">
                <Crown size={20} className="iconRoleBanner" />
                <div className="accessRoleCardBannerInfo">
                  <h3>Admin (Direksi & Manajemen)</h3>
                  <span>Role Code: <code>admin</code> • Manajemen Pabrik</span>
                </div>
                <span className="accessRolePill admin">AKTIF</span>
              </div>
              <div className="accessRoleCardContent">
                <p className="roleDescriptionText">
                  Dirancang khusus untuk jajaran <strong>Direksi, Manajemen, dan Pengawas Pabrik Gula</strong>. Digunakan untuk memantau performa mutu tebu, evaluasi 7 kelas mutu SPAT, audit rekonsiliasi data, serta <strong>menyetujui (Approve) atau menolak (Reject)</strong> permohonan penghapusan frame/siklus mutu yang diajukan oleh Operator.
                </p>

                <div className="rolePolicySummaryBox">
                  <div className="rolePolicyBoxHead">
                    <ShieldCheck size={14} />
                    <span>BATASAN & ATURAN KEAMANAN DIREKSI:</span>
                  </div>
                  <ul>
                    <li className="forbidden">
                      <XCircle size={13} className="bulletIcon red" />
                      <span><strong>Kontrol Conveyor Dikunci:</strong> Dibatasi dari tombol Start Scan / Stop Scan untuk mencegah gangguan operasional fisik di meja giling.</span>
                    </li>
                    <li className="allowed">
                      <CheckCircle2 size={13} className="bulletIcon green" />
                      <span><strong>Wewenang Otorisasi Mutu (Checker):</strong> Memutuskan persetujuan (Approve) atau penolakan (Reject) atas permohonan penghapusan frame/siklus.</span>
                    </li>
                    <li className="allowed">
                      <CheckCircle2 size={13} className="bulletIcon green" />
                      <span><strong>Audit & Laporan Eksekutif:</strong> Akses penuh dashboard, ekspor CSV/Excel laporan, dan rekonsiliasi antrean pabrik.</span>
                    </li>
                  </ul>
                </div>
              </div>
            </article>

            {/* Card 2: Operator Lapangan */}
            <article className="accessRoleCard highlightOperator">
              <div className="accessRoleCardBanner operator">
                <Activity size={20} className="iconRoleBanner" />
                <div className="accessRoleCardBannerInfo">
                  <h3>Operator (Operasional Lapangan)</h3>
                  <span>Role Code: <code>operator</code> • Stasiun Meja Tebu</span>
                </div>
                <span className="accessRolePill operator">AKTIF</span>
              </div>
              <div className="accessRoleCardContent">
                <p className="roleDescriptionText">
                  Dirancang untuk <strong>Petugas Lapangan di Stasiun Meja Tebu (MBS)</strong>. Bertanggung jawab mengendalikan pemindaian conveyor saat tebu dibongkar, memantau CCTV streaming secara realtime, dan melakukan sinkronisasi data tapping SPAT.
                </p>

                <div className="rolePolicySummaryBox">
                  <div className="rolePolicyBoxHead">
                    <ShieldCheck size={14} />
                    <span>BATASAN & ATURAN KEAMANAN OPERATOR:</span>
                  </div>
                  <ul>
                    <li className="allowed">
                      <CheckCircle2 size={13} className="bulletIcon green" />
                      <span><strong>Kontrol Penuh Pemindaian:</strong> Bebas memulai (Start Scan) dan menghentikan (Stop Scan) siklus meja tebu.</span>
                    </li>
                    <li className="allowed">
                      <CheckCircle2 size={13} className="bulletIcon green" />
                      <span><strong>Auto-Stop & CCTV:</strong> Memantau visual tebu dan deteksi keluar-frame CCTV secara otomatis.</span>
                    </li>
                    <li className="forbidden">
                      <XCircle size={13} className="bulletIcon red" />
                      <span><strong>Dilarang Hapus Mandiri:</strong> Tidak dapat menghapus frame/siklus secara langsung; wajib mengajukan permohonan kepada Direksi (Admin).</span>
                    </li>
                  </ul>
                </div>
              </div>
            </article>

            {/* Card 3: Developer */}
            <article className="accessRoleCard highlightDev">
              <div className="accessRoleCardBanner dev">
                <Shield size={20} className="iconRoleBanner" />
                <div className="accessRoleCardBannerInfo">
                  <h3>Developer (Super Admin)</h3>
                  <span>Role Code: <code>developer</code> • Sistem Global</span>
                </div>
                <span className="accessRolePill dev">SISTEM</span>
              </div>
              <div className="accessRoleCardContent">
                <p className="roleDescriptionText">
                  Akses rekayasa sistem untuk tim teknis Vale Amaze Mekaar: pemeliharaan model AI ONNX, kalibrasi CCTV RTSP, dan pengelolaan multi-tenant antar pabrik gula.
                </p>
                <div className="accessPermissionCount">
                  <CheckCircle2 size={13} />
                  <span>Semua Izin Rekayasa Sistem Aktif Penuh</span>
                </div>
              </div>
            </article>
          </div>
        </div>
      ) : (
        <div className="accessMainCard">
          <div className="accessCardHeader">
            <div className="accessCardTitleGroup">
              <div className="accessCardTitleBadge">
                <ShieldAlert size={12} />
                <span>OTORISASI PERSETUJUAN 2FA DIREKSI (MAKER-CHECKER)</span>
              </div>
              <span className="accessCardSubtitle">
                Antrean permohonan penghapusan frame/siklus mutu dari Operator yang memerlukan otorisasi eksplisit Direksi
              </span>
            </div>
            <div className="accessCardMetaBadge">
              <span className="accessDotLive" />
              <span>{pendingRequests.length} Permohonan Menunggu</span>
            </div>
          </div>

          <div className="accessApprovalsPanel">
            {/* Policy Banner inside approvals */}
            <div className="approvalPolicyInfoCard">
              <ShieldCheck size={24} className="approvalPolicyIcon" />
              <div>
                <strong>Tata Kelola Integritas Data Mutu (Maker-Checker / Four-Eyes Principle)</strong>
                <p>
                  Operator di meja tebu <em>(Maker)</em> hanya dapat mengajukan permohonan penghapusan frame atau siklus dengan mencantumkan alasan operasional. Penghapusan data permanen wajib ditinjau dan disetujui secara eksplisit oleh Akun Admin / Direksi <em>(Checker)</em> untuk menjaga integritas audit laporan pabrik.
                </p>
              </div>
            </div>

            {approvalActionMsg && (
              <div className="approvalActionAlert">
                <CheckCircle2 size={16} />
                <span>{approvalActionMsg}</span>
              </div>
            )}

            {/* Pending Section */}
            <div className="approvalSectionCard">
              <div className="approvalSectionHead">
                <div className="approvalSectionTitle">
                  <Clock size={16} className="iconClockAmber" />
                  <h3>Permohonan Menunggu Persetujuan Direksi</h3>
                </div>
                <span className={`approvalCountPill ${pendingRequests.length > 0 ? "hasPending" : "empty"}`}>
                  {pendingRequests.length} Menunggu
                </span>
              </div>

              {pendingRequests.length === 0 ? (
                <div className="approvalEmptyState">
                  <CheckCircle2 size={32} className="approvalEmptyIcon" />
                  <span>Tidak ada permohonan yang menunggu persetujuan saat ini. Semua data mutu sinkron.</span>
                </div>
              ) : (
                <div className="approvalList">
                  {pendingRequests.map(req => (
                    <div key={req.id} className="approvalItemCard">
                      <div className="approvalItemMain">
                        <div>
                          <div className="approvalItemHeadRow">
                            <span className="approvalTypeTag">{req.targetType}</span>
                            <strong className="approvalItemTitle">{req.targetTitle}</strong>
                          </div>
                          {req.targetSubtitle && <div className="approvalItemSubtitle">{req.targetSubtitle}</div>}
                          <div className="approvalItemMeta">
                            Diajukan oleh: <strong className="requesterName">{req.requestedBy}</strong> ({new Date(req.requestedAt).toLocaleString()})
                          </div>
                          <div className="approvalItemReason">
                            <span className="reasonLabel">Alasan: </span> {req.reason}
                            {req.notes && <span className="reasonNotes"> — "{req.notes}"</span>}
                          </div>
                        </div>

                        {/* Action buttons if Admin or Developer */}
                        {(isAdmin || isDeveloper) ? (
                          <div className="approvalItemActions">
                            <button
                              type="button"
                              className="approvalBtn reject"
                              onClick={async () => {
                                try {
                                  setBusy(true);
                                  await reviewDeletionRequest(req.id, "rejected", "Ditolak oleh Direksi");
                                  setApprovalActionMsg(`Permohonan ${req.targetTitle} ditolak.`);
                                } catch (err) {
                                  setError(String(err));
                                } finally {
                                  setBusy(false);
                                }
                              }}
                              disabled={busy}
                            >
                              <XCircle size={14} />
                              <span>Tolak</span>
                            </button>
                            <button
                              type="button"
                              className="approvalBtn approve"
                              onClick={async () => {
                                try {
                                  setBusy(true);
                                  await reviewDeletionRequest(req.id, "approved", "Disetujui oleh Direksi");
                                  setApprovalActionMsg(`Permohonan ${req.targetTitle} disetujui & data telah dihapus.`);
                                } catch (err) {
                                  setError(String(err));
                                } finally {
                                  setBusy(false);
                                }
                              }}
                              disabled={busy}
                            >
                              <CheckCircle2 size={14} />
                              <span>Setujui & Hapus</span>
                            </button>
                          </div>
                        ) : (
                          <span className="approvalWaitingNotice">
                            Menunggu review & approval Akun Direksi
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* History Section */}
            <div className="approvalSectionCard">
              <div className="approvalSectionHead">
                <div className="approvalSectionTitle">
                  <FileCheck size={16} />
                  <h3>Riwayat Keputusan Otorisasi Direksi</h3>
                </div>
              </div>

              {historyRequests.length === 0 ? (
                <div className="approvalEmptyState small">
                  <span>Belum ada riwayat permohonan yang diputuskan.</span>
                </div>
              ) : (
                <div className="approvalHistoryList">
                  {historyRequests.map(req => {
                    const isApproved = req.status === "approved";
                    return (
                      <div key={req.id} className="approvalHistoryItem">
                        <div className="approvalHistoryMain">
                          <span className={`approvalStatusBadge ${isApproved ? "approved" : "rejected"}`}>
                            {isApproved ? "DISETUJUI" : "DITOLAK"}
                          </span>
                          <div className="approvalHistoryInfo">
                            <strong>{req.targetTitle}</strong>
                            <span className="approvalHistoryReason">({req.reason})</span>
                          </div>
                        </div>

                        <div className="approvalHistoryReviewer">
                          Diputuskan oleh: <strong>{req.reviewedBy}</strong> pada {req.reviewedAt ? new Date(req.reviewedAt).toLocaleDateString() : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Edit/Add Role */}
      {editingRole && (
        <div className="accessOverlay">
          <form className="accessModal" onSubmit={saveRole}>
            <div className="accessModalHead">
              <h2>{editingRole === "new" ? "Tambah Role" : "Edit Role"}</h2>
              <button type="button" onClick={() => setEditingRole(null)}><X size={18}/></button>
            </div>
            <label>
              Kode role
              <input required disabled={editingRole !== "new"} pattern="[a-z][a-z0-9_]{2,49}" value={roleForm.code} onChange={e => setRoleForm({ ...roleForm, code: e.target.value.toLowerCase() })}/>
            </label>
            <label>
              Nama role
              <input required value={roleForm.name} onChange={e => setRoleForm({ ...roleForm, name: e.target.value })}/>
            </label>
            <label>
              Deskripsi
              <input value={roleForm.description} onChange={e => setRoleForm({ ...roleForm, description: e.target.value })}/>
            </label>
            <div className="accessPermissionList">
              {Object.entries(permissionGroups).map(([group, values]) => (
                <fieldset key={group}>
                  <legend>{group}</legend>
                  {values.map(p => (
                    <label key={p.value}>
                      <input 
                        type="checkbox" 
                        checked={roleForm.permissions.includes(p.value)} 
                        onChange={e => setRoleForm({ 
                          ...roleForm, 
                          permissions: e.target.checked 
                            ? [...roleForm.permissions, p.value] 
                            : roleForm.permissions.filter(v => v !== p.value) 
                        })}
                      />
                      {p.label}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            <button className="primary" disabled={busy}>Simpan Role</button>
          </form>
        </div>
      )}

      {/* Modal Edit/Add User */}
      {editingUser && (
        <div className="accessOverlay">
          <form className="accessModal" onSubmit={saveUser}>
            <div className="accessModalHead">
              <h2>{editingUser === "new" ? "Tambah User" : "Edit User"}</h2>
              <button type="button" onClick={() => setEditingUser(null)}><X size={18}/></button>
            </div>
            <label>
              Username
              <input required minLength={3} disabled={editingUser !== "new"} value={userForm.username} onChange={e => setUserForm({ ...userForm, username: e.target.value })}/>
            </label>
            <label>
              Password {editingUser !== "new" && <small>(kosongkan bila tidak diubah)</small>}
              <span className="passwordField">
                <input 
                  type={passwordVisible ? "text" : "password"} 
                  required={editingUser === "new"} 
                  minLength={8} 
                  value={userForm.password} 
                  onChange={e => setUserForm({ ...userForm, password: e.target.value })}
                />
                <button type="button" className="passwordVisibilityButton" onClick={() => setPasswordVisible(visible => !visible)} aria-label={passwordVisible ? "Sembunyikan password" : "Lihat password"} title={passwordVisible ? "Sembunyikan password" : "Lihat password"}>
                  {passwordVisible ? <EyeOff size={18}/> : <Eye size={18}/>}
                </button>
              </span>
            </label>
            <label>
              Role
              <select value={userForm.roleId} onChange={e => setUserForm({ ...userForm, roleId: Number(e.target.value) })}>
                {manageableRoles.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </label>
            <label className="accessCheck">
              <input type="checkbox" checked={userForm.active} onChange={e => setUserForm({ ...userForm, active: e.target.checked })}/> 
              Akun aktif
            </label>
            <button className="primary" disabled={busy}>Simpan User</button>
          </form>
        </div>
      )}
    </div>
  );
}
