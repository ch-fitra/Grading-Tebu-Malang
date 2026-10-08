import React, { useState } from "react";
import { Send, X, AlertTriangle, FileText, CheckCircle2, ShieldCheck, Clock } from "lucide-react";
import { useAppStore } from "../store";

interface RequestDeletionModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetType: "inference" | "truck_inspection" | "all_inferences";
  targetId: number | string;
  targetTitle: string;
  targetSubtitle?: string;
  snapshotPath?: string;
  onSubmitted?: () => void;
}

const COMMON_REASONS = [
  "Frame Buram / Terhalang Uap Pabrik",
  "Meja Tebu Kosong Sebelum Giling (False Trigger)",
  "Kamera CCTV Glitch / Gangguan Sinyal",
  "Objek Asing Non-Tebu Tersorot Kamera",
  "Dobel Pemindaian / Antrean Truk Tertukar",
  "Instruksi Tim QC / Koreksi Lapangan",
  "Lainnya (Perlu Peninjauan Khusus)"
];

export function RequestDeletionModal({
  isOpen,
  onClose,
  targetType,
  targetId,
  targetTitle,
  targetSubtitle,
  snapshotPath,
  onSubmitted
}: RequestDeletionModalProps) {
  const session = useAppStore(s => s.session);
  const submitDeletionRequest = useAppStore(s => s.submitDeletionRequest);

  const [selectedReason, setSelectedReason] = useState(COMMON_REASONS[0]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const userFactory = (() => {
    const u = (session?.user.username || "").toLowerCase();
    if (u.includes("kebonagung") || u.includes("malang")) return "kebonagung";
    if (u.includes("trangkil")) return "trangkil";
    return "all";
  })();

  const expectedAdminUser = userFactory === "kebonagung" 
    ? "admin_kebonagung (Direksi PG Kebon Agung)" 
    : userFactory === "trangkil" 
    ? "admin_trangkil (Direksi PT Trangkil)" 
    : "Admin / Direksi Pabrik";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const fullReason = notes.trim() 
        ? `${selectedReason}: ${notes.trim()}` 
        : selectedReason;

      await submitDeletionRequest({
        targetType,
        targetId,
        targetTitle,
        targetSubtitle,
        snapshotPath,
        reason: selectedReason,
        notes: notes.trim() || undefined
      });

      setSuccessMsg("Pengajuan penghapusan berhasil dikirim! Menunggu persetujuan Direksi.");
      if (onSubmitted) onSubmitted();

      setTimeout(() => {
        setBusy(false);
        setNotes("");
        setSuccessMsg(null);
        onClose();
      }, 900);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Gagal mengirim pengajuan");
    }
  }

  return (
    <div className="adminApprovalOverlay" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="adminApprovalModal">
        <div className="adminApprovalHead">
          <div className="adminApprovalTitleGroup">
            <div className="adminApprovalBadge">
              <FileText size={13} />
              <span>MAKER-CHECKER • PENGAJUAN PENGHAPUSAN MUTU</span>
            </div>
            <h2>Ajukan Penghapusan Data ke Direksi</h2>
            <p className="adminApprovalSubtitle">
              Sesuai SOP kendali mutu, Akun <strong>Operator</strong> tidak dapat menghapus data secara sepihak. Permohonan Anda akan diteruskan ke antrean persetujuan Akun <strong>Admin (Direksi)</strong> untuk ditinjau.
            </p>
          </div>
          <button 
            type="button" 
            className="adminApprovalCloseBtn" 
            onClick={onClose}
            disabled={busy}
            title="Tutup Modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Target Data Card */}
        <div className="adminApprovalTargetCard">
          <div className="approvalTargetTop">
            <AlertTriangle size={15} className="warningIcon" />
            <span className="approvalTargetLabel">Data yang Diajukan untuk Dihapus:</span>
          </div>

          <div style={{ display: "flex", gap: "12px", alignItems: "center", marginTop: "6px" }}>
            {snapshotPath && (
              <div style={{ width: "68px", height: "52px", borderRadius: "8px", overflow: "hidden", border: "1px solid var(--color-border)", flexShrink: 0, background: "var(--color-surface-soft)" }}>
                <img 
                  src={snapshotPath} 
                  alt="Snapshot" 
                  style={{ width: "100%", height: "100%", objectFit: "cover" }} 
                  onError={(e) => { (e.target as HTMLElement).style.display = "none"; }}
                />
              </div>
            )}
            <div className="approvalTargetContent" style={{ flex: 1 }}>
              <strong>{targetTitle}</strong>
              {targetSubtitle && <span>{targetSubtitle}</span>}
            </div>
          </div>

          <div className="approvalTargetMeta">
            <span>Petugas Pemohon: <strong>{session?.user.username || "Operator"}</strong></span>
            <span>Peninjau Resmi: <strong>{expectedAdminUser}</strong></span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="adminApprovalForm">
          {error && (
            <div className="adminApprovalAlert error">
              <AlertTriangle size={15} />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="adminApprovalAlert success">
              <CheckCircle2 size={15} />
              <span>{successMsg}</span>
            </div>
          )}

          <div className="adminApprovalField">
            <label htmlFor="req-reason">
              Alasan Pengajuan Penghapusan <span className="reqStar">*</span>
            </label>
            <select
              id="req-reason"
              value={selectedReason}
              onChange={(e) => setSelectedReason(e.target.value)}
              disabled={busy}
            >
              {COMMON_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div className="adminApprovalField">
            <label htmlFor="req-notes">
              Keterangan Tambahan / Penjelasan Operator <small className="fieldHint" style={{ marginLeft: "4px" }}>(Opsional)</small>
            </label>
            <textarea
              id="req-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contoh: Kamera kotor tersapu uap giling jam 12.20, frame tidak dapat dianalisis dengan akurat."
              rows={3}
              disabled={busy}
            />
          </div>

          <div className="adminApprovalNotice">
            <ShieldCheck size={16} className="adminApprovalNoticeIcon" />
            <div>
              <strong>Alur Kerja Persetujuan:</strong> Data tidak akan langsung hilang. Akun Admin (Direksi) akan menerima notifikasi untuk memeriksa gambar dan memutuskan apakah permohonan <strong>Disetujui</strong> atau <strong>Ditolak</strong>.
            </div>
          </div>

          <div className="adminApprovalActions">
            <button
              type="button"
              className="adminApprovalBtn cancel"
              onClick={onClose}
              disabled={busy}
            >
              Batal
            </button>
            <button
              type="submit"
              className="adminApprovalBtn approve"
              disabled={busy}
            >
              <Send size={15} />
              <span>{busy ? "Mengirim Pengajuan..." : "Kirim Pengajuan ke Direksi"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
