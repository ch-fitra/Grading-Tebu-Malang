import { useState, type CSSProperties, type FormEvent } from "react";
import { Camera, Plus, Pencil, Trash2, RefreshCw, Search, X, Eye, EyeOff, PlugZap, CheckCircle2, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { useAppStore } from "../store";
import { api, backendUrl } from "../utils/api";
import type { CameraRow } from "../types";
import { Header } from "./shared/Header";
import { usePanelSize } from "../hooks/usePanelSize";
import "./CameraConfigurationPage.css";

type CameraDraft = Pick<CameraRow, "name" | "location" | "rtspUrl" | "station" | "enabled">;
type Notice = { text: string; warning?: boolean };
const emptyDraft = (): CameraDraft => ({ name: "", location: "", rtspUrl: "", station: 2, enabled: true });

function safeEndpoint(value: string) {
  if (!value) return "Belum dikonfigurasi";
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}/••••`;
  } catch { return "Endpoint tersimpan"; }
}

export function CameraConfigurationPage() {
  const { cameras, status, session, refresh } = useAppStore();
  const canWrite = session?.user.permissions.includes("camera.write") ?? false;
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<CameraRow | "new" | null>(null);
  const [draft, setDraft] = useState<CameraDraft>(emptyDraft);
  const [showEndpoint, setShowEndpoint] = useState(false);
  const [deleting, setDeleting] = useState<CameraRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewingEndpoint, setViewingEndpoint] = useState<CameraRow | null>(null);
  const [preview, setPreview] = useState<{ camera: CameraRow; key: number } | null>(null);
  const [page, setPage] = useState(1);
  const tableSize = usePanelSize<HTMLDivElement>();
  const tableHeadSize = usePanelSize<HTMLTableSectionElement>();
  const rowHeight = tableSize.height < 300 ? 60 : 72;
  const live = (camera: CameraRow) => camera.enabled && status?.ai.cameras?.[String(camera.id)]?.live === true;
  const filtered = cameras.filter(camera => `${camera.name} ${camera.location} MBS ${camera.station}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.station - b.station);
  const pageSize = Math.max(1, Math.floor((tableSize.height - tableHeadSize.height - 1) / rowHeight));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const startIndex = (currentPage - 1) * pageSize;
  const visibleCameras = filtered.slice(startIndex, startIndex + pageSize);

  function openEditor(camera?: CameraRow) {
    setEditing(camera ?? "new");
    setDraft(camera ? { name: camera.name, location: camera.location, rtspUrl: camera.rtspUrl, station: camera.station, enabled: camera.enabled } : { ...emptyDraft(), station: [2, 1, 3, 4, 5, ...Array.from({ length: 94 }, (_, i) => i + 6)].find(station => !cameras.some(item => item.station === station)) ?? 2 });
    setError(null);
    setShowEndpoint(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await api<CameraRow & { syncStatus: string }>(editing === "new" ? "/api/cameras" : `/api/cameras/${editing.id}`, {
        method: editing === "new" ? "POST" : "PUT", body: JSON.stringify(draft),
      });
      setEditing(null);
      setNotice(result.syncStatus === "pending"
        ? { text: "Konfigurasi tersimpan. Layanan AI belum merespons; sinkronisasi akan dicoba kembali otomatis.", warning: true }
        : { text: "Konfigurasi kamera tersimpan dan diterapkan ke layanan AI." });
      await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Konfigurasi gagal disimpan"); }
    finally { setBusy(false); }
  }

  async function toggle(camera: CameraRow) {
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await api<CameraRow & { syncStatus: string }>(`/api/cameras/${camera.id}`, { method: "PUT", body: JSON.stringify({ enabled: !camera.enabled }) });
      setNotice({ text: result.syncStatus === "pending" ? "Perubahan tersimpan; menunggu sinkronisasi layanan AI." : `Kamera ${camera.enabled ? "dinonaktifkan" : "diaktifkan"}.`, warning: result.syncStatus === "pending" });
      await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Status gagal diubah"); }
    finally { setBusy(false); }
  }

  async function test(camera: CameraRow) {
    setBusy(true); setError(null); setNotice(null); setPreview(null);
    try {
      const result = await api<{ connected: boolean; message: string }>(`/api/cameras/${camera.id}/test`, { method: "POST" });
      setNotice({ text: result.message, warning: !result.connected });
      if (result.connected) setPreview({ camera, key: Date.now() });
      await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Pengujian koneksi gagal"); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true); setError(null);
    try {
      await api(`/api/cameras/${deleting.id}`, { method: "DELETE" });
      setDeleting(null); setNotice({ text: "Kamera dihapus dari konfigurasi dan dinonaktifkan pada layanan AI." });
      await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Kamera gagal dihapus"); }
    finally { setBusy(false); }
  }

  return (
    <section className="cameraConfigPage fixedWorkspace">
      <Header title="Konfigurasi Kamera" subtitle="PT Kebon Agung · Unit PG Kebon Agung, Malang" action={canWrite && <button className="cameraConfigPrimary" onClick={() => openEditor()} disabled={busy}><Plus size={16} /> Tambah Kamera</button>} />
      <div className="cameraConfigStats" aria-label="Ringkasan kamera"><div><Camera size={19} /><strong>{cameras.length}</strong><span>Terdaftar</span></div><div><CheckCircle2 size={19} /><strong>{cameras.filter(camera => camera.enabled).length}</strong><span>Aktif</span></div><div><PlugZap size={19} /><strong>{cameras.filter(live).length}</strong><span>Terhubung</span></div><p>Kelola sumber RTSP dan pemetaan meja MBS.</p></div>
      {notice && <div className={`cameraConfigNotice ${notice.warning ? "warning" : ""}`} role="status">{notice.warning ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}<span>{notice.text}</span><button className="cameraConfigIcon" aria-label="Tutup pemberitahuan" onClick={() => setNotice(null)}><X size={15} /></button></div>}
      {error && !editing && !deleting && <div className="cameraConfigError" role="alert"><span>{error}</span><button className="cameraConfigIcon" aria-label="Tutup pesan kesalahan" onClick={() => setError(null)}><X size={15} /></button></div>}
      <div className="cameraConfigPanel">
        <div className="cameraConfigToolbar"><h3><Camera size={18} /> Daftar Kamera <span>{cameras.length}</span></h3><div><span className="cameraConfigBusy" role="status">{busy ? "Memproses…" : ""}</span><label className="cameraConfigSearch"><Search size={15} /><input aria-label="Cari kamera" placeholder="Cari kamera, lokasi, atau MBS…" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label><button className="cameraConfigIcon" aria-label="Muat ulang kamera" onClick={() => void refresh()} disabled={busy}><RefreshCw size={16} /></button></div></div>
        <div className="cameraConfigTableWrap" ref={tableSize.ref} style={{ "--camera-row-height": `${rowHeight}px` } as CSSProperties}><table className="cameraConfigTable" data-readonly={!canWrite}><thead ref={tableHeadSize.ref}><tr><th>Kamera</th><th>Meja MBS</th><th>Lokasi</th><th className="cameraConfigEndpointColumn">Endpoint RTSP</th><th>Status</th>{canWrite && <th>Aksi</th>}</tr></thead><tbody>{visibleCameras.map(camera => <tr key={camera.id}>
          <td><strong title={camera.name}>{camera.name}</strong><small>ID kamera #{camera.id}</small><button type="button" className="cameraConfigEndpointCompact cameraConfigSecondary" disabled={!camera.rtspUrl} onClick={() => setViewingEndpoint(camera)}><Eye size={13} /> Lihat RTSP</button></td><td><span className="cameraConfigStation">MBS {camera.station}</span></td><td><span className="cameraConfigLocation" title={camera.location}>{camera.location || "—"}</span></td><td className="cameraConfigEndpointColumn"><div className="cameraConfigSavedEndpoint"><code>{safeEndpoint(camera.rtspUrl)}</code><button type="button" className="cameraConfigIcon" title="Lihat link RTSP tersimpan" aria-label={`Lihat RTSP ${camera.name}`} disabled={!camera.rtspUrl} onClick={() => setViewingEndpoint(camera)}><Eye size={16} /></button></div></td>
          <td><span className={`cameraConfigStatus ${!camera.enabled ? "disabled" : live(camera) ? "live" : "offline"}`}><i />{!camera.enabled ? "Nonaktif" : live(camera) ? "Terhubung" : "Tidak terhubung"}</span>{camera.enabled && !camera.rtspUrl && canWrite && <small>Isi endpoint RTSP</small>}</td>
          {canWrite && <td><div className="cameraConfigActions"><button className="cameraConfigIcon" title="Uji koneksi dan lihat snapshot" aria-label={`Uji koneksi ${camera.name}`} disabled={busy || !camera.enabled || !camera.rtspUrl} onClick={() => void test(camera)}><PlugZap size={17} /></button><button className="cameraConfigIcon" title="Edit kamera" aria-label={`Edit ${camera.name}`} disabled={busy} onClick={() => openEditor(camera)}><Pencil size={16} /></button><button className="cameraConfigToggle" disabled={busy} onClick={() => void toggle(camera)}>{camera.enabled ? "Nonaktifkan" : "Aktifkan"}</button><button className="cameraConfigIcon danger" title="Hapus kamera" aria-label={`Hapus ${camera.name}`} disabled={busy} onClick={() => { setDeleting(camera); setError(null); }}><Trash2 size={16} /></button></div></td>}
        </tr>)}</tbody></table>{!filtered.length && <div className="cameraConfigEmpty"><Camera size={32} /><strong>{cameras.length ? "Kamera tidak ditemukan" : "Belum ada kamera"}</strong><p>{cameras.length ? "Coba kata pencarian lainnya." : "Tambahkan kamera untuk memulai inspeksi PG Kebon Agung."}</p></div>}</div>
        <div className="cameraConfigFooter"><div><span>{filtered.length ? `${startIndex + 1}–${startIndex + visibleCameras.length} dari ${filtered.length} kamera` : "0 kamera"}</span><small>Satu kamera per meja MBS. Nonaktifkan kamera untuk mempertahankan riwayat.</small></div><nav className="cameraConfigPagination" aria-label="Halaman daftar kamera"><button className="cameraConfigIcon" aria-label="Halaman kamera sebelumnya" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={17} /></button><span aria-live="polite">{currentPage} / {pageCount}</span><button className="cameraConfigIcon" aria-label="Halaman kamera berikutnya" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight size={17} /></button></nav></div>
      </div>
      {viewingEndpoint && <div className="cameraConfigBackdrop" onKeyDown={event => { if (event.key === "Escape") setViewingEndpoint(null); }}><div className="cameraConfigDialog" role="dialog" aria-modal="true" aria-labelledby="camera-endpoint-title"><div className="cameraConfigDialogHead"><div><h3 id="camera-endpoint-title">Link RTSP tersimpan</h3><p>{viewingEndpoint.name} - MBS {viewingEndpoint.station}</p></div><button autoFocus type="button" className="cameraConfigIcon" aria-label="Tutup link RTSP" onClick={() => setViewingEndpoint(null)}><X size={19} /></button></div><label>RTSP dari database<textarea readOnly rows={3} aria-label="Link RTSP tersimpan" value={viewingEndpoint.rtspUrl} onFocus={event => event.currentTarget.select()} /></label><small>Konfigurasi ini disimpan di database instalasi ini. {canWrite ? "Gunakan Edit Kamera untuk memperbarui link." : "Akun Anda memiliki akses baca; perubahan dilakukan pengelola kamera."}</small><div className="cameraConfigDialogFoot"><button type="button" className="cameraConfigSecondary" onClick={() => setViewingEndpoint(null)}>Tutup</button></div></div></div>}
      {preview && <div className="cameraConfigBackdrop" onKeyDown={event => { if (event.key === "Escape") setPreview(null); }}><div className="cameraConfigPreview" role="dialog" aria-modal="true" aria-labelledby="camera-preview-title"><div><h3 id="camera-preview-title">Snapshot · {preview.camera.name}</h3><button autoFocus className="cameraConfigIcon" aria-label="Tutup snapshot" onClick={() => setPreview(null)}><X size={18} /></button></div><img src={`${backendUrl}/api/cameras/${preview.camera.id}/snapshot?overlay=false&t=${preview.key}`} alt={`Snapshot ${preview.camera.name}`} onError={() => { setPreview(null); setError("Snapshot belum tersedia. Ulangi uji koneksi setelah kamera terhubung."); }} /></div></div>}
      {editing && <div className="cameraConfigBackdrop" onKeyDown={event => { if (event.key === "Escape" && !busy) setEditing(null); }}><form className="cameraConfigDialog" role="dialog" aria-modal="true" aria-labelledby="camera-dialog-title" onSubmit={save}>
        <div className="cameraConfigDialogHead"><div><h3 id="camera-dialog-title">{editing === "new" ? "Tambah Kamera" : "Edit Kamera"}</h3><p>Unit PG Kebon Agung · Malang, Jawa Timur</p></div><button type="button" className="cameraConfigIcon" aria-label="Tutup formulir" disabled={busy} onClick={() => setEditing(null)}><X size={19} /></button></div>
        <label>Nama kamera<input autoFocus required maxLength={100} value={draft.name} placeholder="Contoh: CCTV Meja Tebu 2" onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
        <div className="cameraConfigFormRow"><label>Nomor meja MBS<input required type="number" min={1} max={99} value={draft.station} onChange={event => setDraft({ ...draft, station: Number(event.target.value) })} /></label><label>Lokasi<input maxLength={100} value={draft.location} placeholder="Contoh: Stasiun penerimaan tebu" onChange={event => setDraft({ ...draft, location: event.target.value })} /></label></div>
        <label>Endpoint RTSP<div className="cameraConfigEndpoint"><input required type={showEndpoint ? "text" : "password"} autoComplete="off" spellCheck={false} maxLength={2000} pattern="[Rr][Tt][Ss][Pp][Ss]?://.+" placeholder="rtsp://USER:PASSWORD@HOST:554/stream" value={draft.rtspUrl} onChange={event => setDraft({ ...draft, rtspUrl: event.target.value })} /><button type="button" className="cameraConfigIcon" aria-label={showEndpoint ? "Sembunyikan endpoint" : "Tampilkan endpoint"} onClick={() => setShowEndpoint(!showEndpoint)}>{showEndpoint ? <EyeOff size={18} /> : <Eye size={18} />}</button></div><small>Gunakan RTSP/RTSPS. Encode karakter khusus pada username/password, misalnya @ menjadi %40.</small></label>
        <label className="cameraConfigCheckbox"><input type="checkbox" checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} /> Aktifkan kamera untuk inspeksi</label>
        {error && <div className="cameraConfigError" role="alert">{error}</div>}
        <div className="cameraConfigDialogFoot"><button type="button" className="cameraConfigSecondary" disabled={busy} onClick={() => setEditing(null)}>Batal</button><button type="submit" className="cameraConfigPrimary" disabled={busy}>{busy ? "Menyimpan…" : "Simpan Konfigurasi"}</button></div>
      </form></div>}
      {deleting && <div className="cameraConfigBackdrop"><div className="cameraConfigDialog" role="alertdialog" aria-modal="true" aria-labelledby="camera-delete-title"><h3 id="camera-delete-title">Hapus kamera?</h3><p><strong>{deleting.name}</strong> akan dihapus dari konfigurasi PG Kebon Agung. Kamera yang memiliki riwayat harus dinonaktifkan agar data inspeksi tetap tersedia.</p>{error && <div className="cameraConfigError" role="alert">{error}</div>}<div className="cameraConfigDialogFoot"><button className="cameraConfigSecondary" disabled={busy} onClick={() => { setDeleting(null); setError(null); }}>Batal</button><button className="cameraConfigPrimary danger" disabled={busy} onClick={() => void remove()}>Hapus Kamera</button></div></div></div>}
    </section>
  );
}
