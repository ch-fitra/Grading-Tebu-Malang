import { usePanelSize } from "../hooks/usePanelSize";
import { dominantGrade } from "../utils/grade-data";
import { useState, useEffect, useRef } from "react";
import {
  X,
  Truck,
  FileText,
  Camera,
  ShieldCheck,
  ChevronDown,
  Filter,
  Layers,
  Activity,
  Eye,
  HelpCircle
} from "lucide-react";
import type { TruckInspectionSession, InferenceResult } from "../types";
import { KEBONAGUNG_GRADES, gradeDefinition, normalizeGrade, type KebonAgungGradeItem } from "../utils/grade-guide";

interface TruckInspectionDetailModalProps {
  session: TruckInspectionSession;
  history: InferenceResult[];
  onClose: () => void;
  onViewCapture: (capture: InferenceResult) => void;
}

import { useAppStore } from "../store";
import { resolveMbsStation } from "../utils/stations";

export function TruckInspectionDetailModal({ session, history, onClose, onViewCapture }: TruckInspectionDetailModalProps) {
  const cameras = useAppStore(state => state.cameras);
  const modalSize = usePanelSize<HTMLDivElement>();
  const compactLayout = modalSize.width < 850 || modalSize.height < 540;
  const [detailPanel, setDetailPanel] = useState("frames");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedGradeFilter, setSelectedGradeFilter] = useState<string | "all">("all");
  const [pageSize, setPageSize] = useState(10);
  const frameTableRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = frameTableRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.height > 0) setPageSize(compactLayout ? Math.max(1, Math.min(10, Math.floor((entry.contentRect.height - 28) / 32))) : 10);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [compactLayout, detailPanel]);
  const [gradePickerOpen, setGradePickerOpen] = useState(false);
  const gradePickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!gradePickerRef.current?.contains(event.target as Node)) setGradePickerOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  // Filter rekaman capture yang berasosiasi dengan sesi inspeksi truk ini
  const sessionCaptures = history.filter(item => {
    if (session.captureIds && session.captureIds.length > 0) {
      return session.captureIds.includes(item.id);
    }
    const started = new Date(session.startedAt).getTime();
    const ended = session.completedAt ? new Date(session.completedAt).getTime() : Date.now();
    const itemTime = new Date(item.timestamp).getTime();
    return itemTime >= started - 15000 && itemTime <= ended + 15000;
  });
  
  // Urutkan tangkapan berdasarkan timestamp secara kronologis
  const sortedCaptures = [...sessionCaptures].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Filter capture berdasarkan pilihan mutu
  const filteredCaptures = sortedCaptures.filter(item => {
    if (selectedGradeFilter === "all") return true;
    return normalizeGrade(item.grade) === selectedGradeFilter;
  });

  const totalPages = Math.max(1, Math.ceil(filteredCaptures.length / pageSize));
  const pageIndex = Math.min(currentPage, totalPages);
  const visibleCaptures = filteredCaptures.slice((pageIndex - 1) * pageSize, pageIndex * pageSize);

  // Format durasi inspeksi
  const getDuration = () => {
    const end = session.completedAt ? new Date(session.completedAt).getTime() : Date.now();
    const start = new Date(session.startedAt).getTime();
    const diff = Math.max(0, end - start);
    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return `${mins}m ${secs}s`;
  };

  // Evaluasi kelas mutu akhir sesi truk
  const finalGradeCode = dominantGrade(sessionCaptures) ?? "";
  const curGradeConfig: KebonAgungGradeItem = gradeDefinition(finalGradeCode);
  const station = resolveMbsStation(session.line, cameras);
  const mbsInfo = { ...station, factory: "PG Kebon Agung (Malang)", full: `${station.label} - Meja Tebu ${station.mbsNum} (PG Kebon Agung)` };

  const isCompleted = session.status === "completed";

  return (
    <div 
      className="modal-backdrop" 
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title-truck-detail"
    >
      <div 
        ref={modalSize.ref} className="capture-detail-modal truck-detail-modal" data-compact={compactLayout} data-panel={detailPanel}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Modal */}
        <div className="capture-detail-modal__header truck-detail-header">
          <div className="modal-title-with-badge">
            <div className="modal-title-row">
              <div className="modal-badge-icon" title="Sesi Inspeksi Truk Tebu">
                <Truck size={16} />
              </div>
              <h2 id="modal-title-truck-detail">DETAIL SESI INSPEKSI TRUK & MEJA TEBU</h2>
              <span className="modal-batch-pill">SISTEM AI GRADING</span>
              <span className={`truck-status-tag ${isCompleted ? "completed" : "active"}`}>
                {isCompleted ? "SELESAI" : "SEDANG BERLANGSUNG"}
              </span>
            </div>
            <p>
              ID Sesi: <code className="truck-session-code">{session.id}</code> &bull; Lokasi: <strong>{mbsInfo.full}</strong>
            </p>
          </div>
          <button 
            type="button" 
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Tutup detail modal"
            title="Tutup (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body Modal: 2 Kolom Seimbang (Kiri: Evaluasi Mutu & Metadata | Kanan: Log Siklus Deteksi) */}
        <nav className="responsiveDetailTabs" aria-label="Tampilan detail siklus">
          {[['summary', 'Ringkasan'], ['metadata', 'Informasi'], ['frames', `${pageSize} Frame`], ['guide', 'Panduan']].map(([id, label]) => <button key={id} aria-pressed={detailPanel === id} onClick={() => setDetailPanel(id)}>{label}</button>)}
        </nav>
        <div className="capture-detail-modal__body truck-detail-body">
          {/* Kolom Kiri */}
          <div className="truck-left-column">
            {/* Hero Card Evaluasi Mutu Tebu AI */}
            <div 
              className="truck-hero-grade-card"
              style={{ borderColor: `${curGradeConfig.color}45` }}
            >
              <div className="truck-hero-grade-header">
                <span className="truck-hero-tag">
                  <Activity size={11} />
                  <span>PREDICTED GRADE (RATA-RATA SIKLUS TRUK)</span>
                </span>
                <span className="truck-conf-pill">
                  {Math.round((session.averageConfidence ?? 0) * 100)}% Keyakinan AI
                </span>
              </div>

              <div className="truck-hero-grade-main">
                <div className="truck-grade-badge-wrap">
                  <span className={`truck-grade-pill ${curGradeConfig.badgeCls}`}>
                    {curGradeConfig.code}
                  </span>
                </div>
                <div className="truck-grade-info">
                  <strong className="truck-grade-name">{curGradeConfig.label} ({curGradeConfig.name})</strong>
                  <div className="truck-grade-decision">{curGradeConfig.decision}</div>
                  <span className="truck-grade-rafaksi">
                    Kebijakan Rafaksi: <strong>{curGradeConfig.rafaksi}</strong>
                  </span>
                </div>
              </div>

              {/* Ringkasan grading */}
              <div className="truck-hero-metrics-grid">
                <div className="truck-metric-item">
                  <span className="truck-metric-label">Total Frame:</span>
                  <strong className="truck-metric-val">{session.totalCaptures} Frame</strong>
                </div>
                <div className="truck-metric-item">
                  <span className="truck-metric-label">Status Giling:</span>
                  <strong className="truck-metric-val">{curGradeConfig.status}</strong>
                </div>
              </div>
            </div>

            {/* Kartu Metadata Truk & Meja Tebu (Grid 2-Kolom Kompak) */}
            <div className="truck-detail-card truck-metadata-card">
              <div className="truck-card-title-bar">
                <Truck size={12} />
                <h4>METADATA TRUK & MEJA TEBU</h4>
              </div>
              <div className="truck-metadata-grid">
                <div className="truck-meta-item">
                  <span className="truck-meta-key">Kode Truk / Siklus</span>
                  <strong className="truck-meta-val highlight">{session.truckCode}</strong>
                </div>
                <div className="truck-meta-item">
                  <span className="truck-meta-key">Stasiun Meja Tebu</span>
                  <strong className="truck-meta-val">{mbsInfo.label} ({mbsInfo.subLabel})</strong>
                </div>
                <div className="truck-meta-item">
                  <span className="truck-meta-key">Pabrik Gula</span>
                  <strong className="truck-meta-val">{mbsInfo.factory}</strong>
                </div>
                <div className="truck-meta-item">
                  <span className="truck-meta-key">Nopol & Driver</span>
                  <strong className="truck-meta-val">
                    {session.plateNumber || session.driverName 
                      ? `${session.plateNumber || "—"}${session.driverName ? ` (${session.driverName})` : ""}`
                      : "—"}
                  </strong>
                </div>
                <div className="truck-meta-item">
                  <span className="truck-meta-key">Waktu Mulai</span>
                  <strong className="truck-meta-val">
                    {new Date(session.startedAt).toLocaleTimeString("id-ID", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    <small> ({new Date(session.startedAt).toLocaleDateString("id-ID")})</small>
                  </strong>
                </div>
                <div className="truck-meta-item">
                  <span className="truck-meta-key">Waktu Selesai (Durasi)</span>
                  <strong className="truck-meta-val">
                    {session.completedAt 
                      ? `${new Date(session.completedAt).toLocaleTimeString("id-ID", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })} (${getDuration()})`
                      : `Berlangsung (${getDuration()})`}
                  </strong>
                </div>
              </div>
              {session.notes && (
                <div className="truck-notes-inline">
                  <FileText size={10} />
                  <span><strong>Catatan:</strong> {session.notes}</span>
                </div>
              )}
            </div>

            {/* Kartu Standar Evaluasi 7 Kelas Mutu PG Kebon Agung (Kompak & Presisi) */}
            <div className="truck-detail-card truck-grades-card">
              <div className="truck-card-title-bar">
                <ShieldCheck size={12} />
                <h4>STANDAR 7 KELAS MUTU TEBU (AI)</h4>
              </div>
              <div className="truck-grades-compact-guide">
                {KEBONAGUNG_GRADES.map(item => {
                  const isMatch = item.code === curGradeConfig.code;
                  return (
                    <div 
                      key={item.code} 
                      className={`truck-guide-row ${isMatch ? "active-grade" : ""}`}
                      style={{
                        borderColor: isMatch ? `${item.color}75` : undefined,
                        background: isMatch ? `${item.color}15` : undefined
                      }}
                    >
                      <span className={`truck-guide-badge ${item.badgeCls}`}>{item.code}</span>
                      <div className="truck-guide-desc">
                        <span className="truck-guide-title">
                          {item.label} <small className="truck-guide-sub">({item.name})</small>
                        </span>
                        <span className="truck-guide-kriteria">Rafaksi {item.rafaksi}</span>
                      </div>
                      {isMatch && (
                        <span className="truck-guide-match-tag">Hasil AI</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Kolom Kanan: Log Siklus Deteksi Frame */}
          <div className="truck-right-column">
            <div className="truck-cycles-header-bar">
              <div className="truck-card-title-bar no-margin">
                <Layers size={13} />
                <h4>
                  LOG FRAME DETEKSI ({filteredCaptures.length}
                  {filteredCaptures.length !== sortedCaptures.length ? ` / ${sortedCaptures.length}` : ""} Frame)
                </h4>
              </div>

              {sortedCaptures.length > 0 && (
                <div className="cycle-detail-grade-filter" ref={gradePickerRef} onKeyDown={(event) => {
                  if (event.key === "Escape" && gradePickerOpen) {
                    event.stopPropagation();
                    setGradePickerOpen(false);
                    gradePickerRef.current?.querySelector<HTMLButtonElement>(".gradePickerTrigger")?.focus();
                  }
                }}>
                  <ShieldCheck size={11} className="filter-icon" />
                  <div className="cycle-grade-select-wrap">
                    <button type="button" className="gradePickerTrigger" aria-haspopup="listbox" aria-expanded={gradePickerOpen}
                      aria-label="Filter mutu frame" onClick={() => setGradePickerOpen(open => !open)}>
                      <span>{selectedGradeFilter === "all" ? "Semua Mutu" : `${selectedGradeFilter}`}</span>
                      <span className="gradePickerCount">{filteredCaptures.length} frame</span>
                      <ChevronDown size={13} />
                    </button>
                    {gradePickerOpen && (
                      <div className="gradePickerMenu" role="listbox" aria-label="Pilihan mutu frame" onKeyDown={event => {
                        const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
                        const index = options.indexOf(document.activeElement as HTMLButtonElement);
                        const next = event.key === "ArrowDown" ? (index + 1) % options.length : event.key === "ArrowUp" ? (index - 1 + options.length) % options.length : event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : null;
                        if (next !== null) { event.preventDefault(); options[next]?.focus(); }
                      }}>
                        <div className="gradePickerMenuHeading">Pilih kelas mutu</div>
                        {[{ code: "all", label: "Semua Mutu", name: "Seluruh frame siklus", color: "#2563eb" }, ...KEBONAGUNG_GRADES].map(grade => {
                          const count = grade.code === "all" ? sortedCaptures.length : sortedCaptures.filter(c => normalizeGrade(c.grade) === grade.code).length;
                          return <button type="button" key={grade.code} role="option" aria-selected={selectedGradeFilter === grade.code} disabled={count === 0}
                            onClick={() => { setSelectedGradeFilter(grade.code); setCurrentPage(1); setGradePickerOpen(false); gradePickerRef.current?.querySelector<HTMLButtonElement>(".gradePickerTrigger")?.focus(); }}>
                            <span className="gradePickerDot" style={{ background: grade.color }} />
                            <span className="gradePickerOptionText"><strong>{grade.label}</strong><small>{grade.name}</small></span>
                            <span className="gradePickerCount">{count}</span>
                          </button>;
                        })}
                      </div>
                    )}
                  </div>
                  {selectedGradeFilter !== "all" && (
                    <button
                      type="button"
                      className="cycle-filter-reset-icon-btn"
                      onClick={() => {
                        setSelectedGradeFilter("all");
                        setCurrentPage(1);
                      }}
                      title="Reset filter mutu"
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Tabel Log Frame Siklus */}
            {sortedCaptures.length === 0 ? (
              <div className="truck-empty-cycles-box">
                <Camera size={32} />
                <p>Belum ada rekaman frame deteksi AI yang tersimpan pada sesi truk ini.</p>
              </div>
            ) : filteredCaptures.length === 0 ? (
              <div className="truck-empty-cycles-box">
                <Filter size={32} />
                <p>Tidak ada frame dengan filter mutu {selectedGradeFilter}.</p>
                <button
                  type="button"
                  className="truck-filter-reset-action"
                  onClick={() => {
                    setSelectedGradeFilter("all");
                    setCurrentPage(1);
                  }}
                >
                  Tampilkan Semua Mutu ({sortedCaptures.length} Frame)
                </button>
              </div>
            ) : (
              <div className="truck-cycles-table-wrapper">
                <div className="truck-table-scroll-area" ref={frameTableRef}>
                  <table className="truck-cycles-log-table">
                    <thead>
                      <tr>
                        <th style={{ width: "95px" }}>Frame</th>
                        <th style={{ width: "105px" }}>Waktu</th>
                        <th style={{ width: "115px" }}>Mutu AI</th>
                        <th style={{ width: "90px" }}>Keyakinan</th>
                        <th style={{ width: "100px", textAlign: "right" }}>Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleCaptures.map((item) => {
                        const cycleNumber = sortedCaptures.findIndex(frame => frame.id === item.id) + 1;
                        const normGrade = normalizeGrade(item.grade);
                        const rowGradeDef = gradeDefinition(normGrade);

                        return (
                          <tr key={item.id} className="truck-cycle-row">
                            <td>
                              <span className="cycle-badge">
                                {cycleNumber}
                              </span>
                            </td>
                            <td>
                              <span className="cycle-time-text">
                                {new Date(item.timestamp).toLocaleTimeString("id-ID", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                              </span>
                            </td>
                            <td>
                              <span className={`table-grade-badge ${rowGradeDef.badgeCls}`}>
                                {normGrade}
                              </span>
                            </td>
                            <td>
                              <span className="conf-val">
                                {Math.round(item.confidence * 100)}%
                              </span>
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <button 
                                type="button" 
                                className="truck-view-cycle-btn"
                                onClick={() => onViewCapture(item)}
                                title="Buka citra visual & rincian deteksi AI frame ini"
                              >
                                <Eye size={12} />
                                <span>Detail</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="truck-table-pagination">
                    <button
                      type="button"
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={pageIndex === 1}
                      className="truck-pag-btn"
                    >
                      Sebelumnya
                    </button>
                    <span className="truck-pag-text">
                      Halaman <strong>{pageIndex}</strong> dari <strong>{totalPages}</strong> ({filteredCaptures.length} Frame)
                    </span>
                    <button
                      type="button"
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={pageIndex === totalPages}
                      className="truck-pag-btn"
                    >
                      Berikutnya
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer Modal */}
        <div className="capture-detail-modal__footer truck-detail-footer">
          <span className="truck-footer-hint">
            <HelpCircle size={13} style={{ marginRight: 5, verticalAlign: "middle" }} />
            Klik tombol <strong>Detail</strong> pada tabel siklus untuk melihat citra snapshot visual dan distribusi probabilitas AI tiap frame.
          </span>
          <button 
            type="button" 
            className="modal-footer-btn secondary truck-close-action-btn"
            onClick={onClose}
          >
            <X size={14} />
            <span>Tutup Jendela</span>
          </button>
        </div>
      </div>
    </div>
  );
}
