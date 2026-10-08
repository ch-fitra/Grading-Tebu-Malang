import { useState } from "react";
import { ShieldCheck, CheckCircle2, XCircle, Clock, AlertTriangle, Eye, X, MessageSquare, History, FileCheck } from "lucide-react";
import { useAppStore } from "../store";
import type { DeletionRequest } from "../types";

interface AdminApprovalQueueModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AdminApprovalQueueModal({ isOpen, onClose }: AdminApprovalQueueModalProps) {
  const session = useAppStore(s => s.session);
  const deletionRequests = useAppStore(s => s.deletionRequests);
  const reviewDeletionRequest = useAppStore(s => s.reviewDeletionRequest);

  const [activeTab, setActiveTab] = useState<"pending" | "history">("pending");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ id: string; msg: string; type: "success" | "error" } | null>(null);

  if (!isOpen) return null;

  const pendingRequests = deletionRequests.filter(r => r.status === "pending");
  const historyRequests = deletionRequests.filter(r => r.status !== "pending");

  async function handleDecision(request: DeletionRequest, decision: "approved" | "rejected") {
    setProcessingId(request.id);
    setActionFeedback(null);

    try {
      const note = reviewNotes[request.id]?.trim();
      const res = await reviewDeletionRequest(request.id, decision, note);

      setActionFeedback({
        id: request.id,
        msg: decision === "approved" 
          ? `Permohonan #${request.targetTitle} telah DISETUJUI & data berhasil dihapus.`
          : `Permohonan #${request.targetTitle} telah DITOLAK. Data tetap disimpan.`,
        type: "success"
      });

      // Clear local note
      setReviewNotes(prev => {
        const next = { ...prev };
        delete next[request.id];
        return next;
      });
    } catch (err) {
      setActionFeedback({
        id: request.id,
        msg: "Gagal memproses permohonan: " + (err instanceof Error ? err.message : String(err)),
        type: "error"
      });
    } finally {
      setProcessingId(null);
    }
  }

  return (
    <div className="adminApprovalOverlay" onClick={(e) => { if (e.target === e.currentTarget && !processingId) onClose(); }}>
      <div className="adminApprovalModal adminApprovalQueueModal">
        {/* Header */}
        <div className="adminApprovalHead">
          <div className="adminApprovalTitleGroup">
            <div className="adminApprovalBadge">
              <ShieldCheck size={13} />
              <span>OTORISASI DIREKSI • PUSAT PERSETUJUAN MUTU</span>
            </div>
            <h2>Pusat Otorisasi & Persetujuan Penghapusan Data</h2>
            <p className="adminApprovalSubtitle">
              Tinjau permohonan penghapusan frame tebu dan siklus giling yang diajukan oleh Operator Lapangan sesuai tata kelola integritas Maker-Checker.
            </p>
          </div>
          <button 
            type="button" 
            className="adminApprovalCloseBtn" 
            onClick={onClose}
            disabled={Boolean(processingId)}
            title="Tutup"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="adminQueueTabsWrap">
          <div className="adminQueueTabs">
            <button
              type="button"
              className={`adminQueueTabBtn ${activeTab === "pending" ? "active" : ""}`}
              onClick={() => setActiveTab("pending")}
            >
              <Clock size={14} />
              <span>Menunggu Persetujuan</span>
              {pendingRequests.length > 0 && (
                <span className="adminQueueBadge pending">
                  {pendingRequests.length}
                </span>
              )}
            </button>

            <button
              type="button"
              className={`adminQueueTabBtn ${activeTab === "history" ? "active" : ""}`}
              onClick={() => setActiveTab("history")}
            >
              <History size={14} />
              <span>Riwayat Keputusan</span>
              <span className="adminQueueBadge history">
                {historyRequests.length}
              </span>
            </button>
          </div>
        </div>

        {/* Global Feedback Banner */}
        {actionFeedback && (
          <div className={`adminApprovalFeedbackBanner ${actionFeedback.type}`}>
            {actionFeedback.type === "success" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <span>{actionFeedback.msg}</span>
          </div>
        )}

        {/* Content Area */}
        <div className="adminQueueContentArea">
          {activeTab === "pending" ? (
            pendingRequests.length === 0 ? (
              <div className="adminQueueEmptyBox">
                <div className="adminQueueEmptyIconRing">
                  <CheckCircle2 size={36} className="adminQueueEmptyIcon" />
                </div>
                <h3>Semua Permohonan Telah Ditinjau</h3>
                <p>Tidak ada permohonan penghapusan frame atau siklus yang menunggu persetujuan saat ini.</p>
              </div>
            ) : (
              <div className="adminQueueList">
                {pendingRequests.map(req => {
                  const isBusyThis = processingId === req.id;
                  return (
                    <div key={req.id} className="adminQueueItemCard">
                      <div className="adminQueueItemTopRow">
                        {req.snapshotPath ? (
                          <div 
                            className="adminQueueThumbWrap"
                            onClick={() => setSelectedImage(req.snapshotPath || null)}
                            title="Klik untuk perbesar foto"
                          >
                            <img 
                              src={req.snapshotPath} 
                              alt="Thumbnail Frame" 
                              className="adminQueueThumbImg"
                              onError={(e) => { (e.target as HTMLElement).style.display = "none"; }}
                            />
                            <div className="adminQueueThumbOverlay">
                              <Eye size={16} color="#fff" />
                            </div>
                          </div>
                        ) : null}

                        <div className="adminQueueItemBody">
                          <div className="adminQueueItemHeaderRow">
                            <div className="adminQueueItemTitleGroup">
                              <span className="adminQueueTypePill">
                                {req.targetType === "inference" ? "Frame Mutu" : req.targetType === "truck_inspection" ? "Siklus Truk" : "Batch"}
                              </span>
                              <strong className="adminQueueItemTitle">{req.targetTitle}</strong>
                            </div>
                            <span className="adminQueueItemTime">
                              <Clock size={12} />
                              <span>{new Date(req.requestedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} WIB</span>
                            </span>
                          </div>

                          {req.targetSubtitle && (
                            <div className="adminQueueItemSub">
                              {req.targetSubtitle}
                            </div>
                          )}

                          <div className="adminQueueItemMetaRow">
                            <span>Pemohon: <strong className="adminQueueRequester">{req.requestedBy}</strong></span>
                            <span>Pabrik: <strong>{req.factory.toUpperCase()}</strong></span>
                          </div>

                          <div className="adminQueueReasonBox">
                            <div className="adminQueueReasonText">
                              <span className="reasonLabel">Alasan Operator: </span>
                              <strong>{req.reason}</strong>
                            </div>
                            {req.notes && (
                              <div className="adminQueueReasonNotes">
                                "{req.notes}"
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Review Action Area */}
                      <div className="adminQueueActionRow">
                        <div className="adminQueueInputWrap">
                          <input 
                            type="text"
                            placeholder="Catatan Direksi (Opsional, misal: Disetujui karena uap terkonfirmasi)..."
                            value={reviewNotes[req.id] || ""}
                            onChange={(e) => setReviewNotes(prev => ({ ...prev, [req.id]: e.target.value }))}
                            disabled={isBusyThis}
                            className="adminQueueNoteInput"
                          />
                        </div>

                        <div className="adminQueueBtnGroup">
                          <button
                            type="button"
                            onClick={() => handleDecision(req, "rejected")}
                            disabled={isBusyThis}
                            className="adminQueueDecisionBtn reject"
                          >
                            <XCircle size={14} />
                            <span>Tolak</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDecision(req, "approved")}
                            disabled={isBusyThis}
                            className="adminQueueDecisionBtn approve"
                          >
                            <CheckCircle2 size={14} />
                            <span>{isBusyThis ? "Memproses..." : "Setujui & Hapus"}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            historyRequests.length === 0 ? (
              <div className="adminQueueEmptyBox">
                <FileCheck size={40} className="adminQueueEmptyIcon muted" />
                <h3>Belum Ada Riwayat Keputusan</h3>
                <p>Riwayat persetujuan dan penolakan oleh Direksi akan tercatat di sini.</p>
              </div>
            ) : (
              <div className="adminQueueHistoryList">
                {historyRequests.map(req => {
                  const isApproved = req.status === "approved";
                  return (
                    <div key={req.id} className="adminQueueHistoryItem">
                      <div className="adminQueueHistoryMain">
                        <div className={`adminQueueStatusBadge ${isApproved ? "approved" : "rejected"}`}>
                          {isApproved ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                          <span>{isApproved ? "DISETUJUI (DIHAPUS)" : "DITOLAK"}</span>
                        </div>

                        <div className="adminQueueHistoryInfo">
                          <strong className="adminQueueHistoryTitle">{req.targetTitle}</strong>
                          <div className="adminQueueHistorySub">
                            Alasan: {req.reason} • Pemohon: {req.requestedBy}
                          </div>
                        </div>
                      </div>

                      <div className="adminQueueHistoryReviewer">
                        <div>Peninjau: <strong>{req.reviewedBy || "Direksi"}</strong></div>
                        {req.reviewedAt && <div>{new Date(req.reviewedAt).toLocaleDateString()} {new Date(req.reviewedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>}
                        {req.reviewNotes && <div className="adminQueueReviewNotes">"{req.reviewNotes}"</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>

        {/* Footer */}
        <div className="adminApprovalFooter">
          <button
            type="button"
            className="adminApprovalBtn cancel"
            onClick={onClose}
          >
            Tutup
          </button>
        </div>
      </div>

      {/* Snapshot Lightbox Preview */}
      {selectedImage && (
        <div 
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.88)",
            zIndex: 99999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px"
          }}
          onClick={() => setSelectedImage(null)}
        >
          <div style={{ position: "relative", maxWidth: "90vw", maxHeight: "90vh" }}>
            <img 
              src={selectedImage} 
              alt="Enlarged" 
              style={{ maxWidth: "100%", maxHeight: "85vh", borderRadius: "8px", border: "2px solid rgba(255,255,255,0.2)" }} 
            />
            <button
              type="button"
              onClick={() => setSelectedImage(null)}
              style={{
                position: "absolute",
                top: "-12px",
                right: "-12px",
                background: "#ef4444",
                color: "#fff",
                border: "none",
                borderRadius: "50%",
                width: "32px",
                height: "32px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
