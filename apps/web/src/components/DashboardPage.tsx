import { RefreshCw, Cpu, Clock, Camera, Radio, Activity, CheckCircle, ShieldAlert, Layers, Monitor, VideoOff, X } from "lucide-react";
import { useState, useEffect } from "react";
import { useAppStore } from "../store";
import { InferenceResult } from "../types";
import { Header } from "./shared/Header";
import { IconButton } from "./shared/IconButton";
import { TruckInspectionPanel } from "./TruckInspectionPanel";

function PanelBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panelBlock">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function LegendItem({ color, title, text }: { color: string; title: string; text: string }) {
  return (
    <div className="legendItem">
      <i className={`swatch ${color}`} />
      <div>
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
    </div>
  );
}

function GuideCard({ color, title, text }: { color: string; title: string; text: string }) {
  return (
    <div className={`guideCard ${color}`}>
      <strong>{title}</strong>
      <p>{text}</p>
      <div className="guidePreview">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="statusLine">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function DashboardPage() {
  const { latest, status, refresh, history, activeTruckSession } = useAppStore();
  const [activeLine, setActiveLine] = useState(1);
  const [capturePage, setCapturePage] = useState(1);
  const [selectedCapture, setSelectedCapture] = useState<InferenceResult | null>(null);
  const [filterActiveTruck, setFilterActiveTruck] = useState(false);

  useEffect(() => {
    if (!selectedCapture) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedCapture(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedCapture]);

  useEffect(() => {
    setCapturePage(1);
    if (!activeTruckSession || activeTruckSession.line !== activeLine) {
      setFilterActiveTruck(false);
    }
  }, [activeLine, history.length, activeTruckSession]);

  const activeLineHistory = (history || [])
    .filter((item) => item.cameraId === activeLine);

  // Filter history if active truck filter is enabled
  const filteredHistory = filterActiveTruck && activeTruckSession && activeTruckSession.line === activeLine
    ? activeLineHistory.filter((item) => activeTruckSession.captureIds.includes(item.id))
    : activeLineHistory;

  const pageSize = 8;
  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / pageSize));
  const currentPage = Math.min(capturePage, totalPages);
  const visibleCaptures = filteredHistory.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const visibleCapturesCount = filteredHistory.length;

  const placeholdersCount = Math.max(0, pageSize - visibleCaptures.length);
  const placeholders = Array.from({ length: placeholdersCount });
  const lines = [1, 2, 3, 4, 5];
  const hasLatestInference = Boolean(latest);
  const classes = latest?.classes ?? { daun: 0, pucuk: 0, sampah: 0 };
  const confidence = latest?.confidence ?? 0;
  const grade = latest?.grade;
  const impurity = classes.daun + classes.pucuk + classes.sampah;
  const background = hasLatestInference ? Math.max(0, 100 - impurity) : 0;
  const totalPixels = 1840000;
  const rows = [
    { name: "daun", color: "green", area: Math.round((classes.daun / 100) * totalPixels), percent: classes.daun },
    { name: "pucuk", color: "yellow", area: Math.round((classes.pucuk / 100) * totalPixels), percent: classes.pucuk },
    { name: "sampah", color: "red", area: Math.round((classes.sampah / 100) * totalPixels), percent: classes.sampah },
    { name: "batang tebu", color: "gray", area: Math.round((background / 100) * totalPixels), percent: background }
  ];

  return (
    <section className="dashboardPage">
      <Header
        title="Dashboard"
        subtitle="Real-time sugar cane impurity scanning control panel"
        action={
          <div className="headerActions">
            <IconButton icon={RefreshCw} label="Refresh" onClick={refresh} />
          </div>
        }
      />

      {/* KPI Cards Grid */}
      <div className="kpiGrid">
        <div className="kpiCard">
          <div className="kpiIconWrap"><Monitor size={18} /></div>
          <div className="kpiText">
            <span className="kpiLabel">Active Line</span>
            <strong className="kpiValue">Line {activeLine}</strong>
            <span className="kpiMicro">Meja {activeLine} Feed</span>
          </div>
        </div>
        <div className="kpiCard">
          <div className="kpiIconWrap"><Cpu size={18} /></div>
          <div className="kpiText">
            <span className="kpiLabel">Predicted Grade</span>
            <strong className={`kpiValue ${grade ? `grade-${grade}` : ""}`}>{grade ? `MBS ${grade}` : "—"}</strong>
            <span className="kpiMicro">Current Quality Tier</span>
          </div>
        </div>
        <div className="kpiCard">
          <div className="kpiIconWrap"><Layers size={18} /></div>
          <div className="kpiText">
            <span className="kpiLabel">Total Impurity</span>
            <strong className="kpiValue impurityValue">{hasLatestInference ? `${impurity.toFixed(2)}%` : "—"}</strong>
            <span className="kpiMicro">Daun + Pucuk + Sampah</span>
          </div>
        </div>
        <div className="kpiCard">
          <div className="kpiIconWrap"><Activity size={18} /></div>
          <div className="kpiText">
            <span className="kpiLabel">AI Confidence</span>
            <strong className="kpiValue">{hasLatestInference ? `${(confidence * 100).toFixed(0)}%` : "—"}</strong>
            <span className="kpiMicro">Model inference rate</span>
          </div>
        </div>
        <div className="kpiCard">
          <div className="kpiIconWrap"><CheckCircle size={18} /></div>
          <div className="kpiText">
            <span className="kpiLabel">System Health</span>
            <strong className={`kpiValue status-${status?.backend.status === "ok" ? "online" : "checking"}`}>
              {status?.backend.status === "ok" ? "ONLINE" : "OFFLINE"}
            </strong>
            <span className="kpiMicro">All systems active</span>
          </div>
        </div>
      </div>

      <div className="lineTabs" role="tablist" aria-label="Tebu line selector">
        {lines.map((line) => (
          <button
            key={line}
            className={activeLine === line ? "active" : ""}
            onClick={() => setActiveLine(line)}
            role="tab"
            aria-selected={activeLine === line}
          >
            <span>Line</span>
            <strong>{line}</strong>
          </button>
        ))}
      </div>
      
      <div className="inspectionGrid">
        <div className="inspectionViewer">
          <div className="viewerHeader">
            <div>
              <strong>Live Segmentation Preview</strong>
              <span>Line {activeLine} Camera - semantic overlay</span>
            </div>
            <div className="liveBadge offlineBadge">
              <Radio size={11} />
              NO STREAM
            </div>
          </div>
          <div className="segmentationCanvas">
            {/* Dark Monitor Panel Grid Overlay */}
            <div className="canvasGridOverlay" />
            <div className="scanLine" />
            
            {/* Corner Brackets & Crosshair */}
            <div className="canvasCorner TL" />
            <div className="canvasCorner TR" />
            <div className="canvasCorner BL" />
            <div className="canvasCorner BR" />
            <div className="canvasCrosshair" />

            {/* Center Empty State Content */}
            <div className="streamEmptyState">
              <div className="streamEmptyIcon">
                <VideoOff size={36} className="pulse-icon-slow" />
              </div>
              <h3>No Stream Connected</h3>
              <p>Line {activeLine} CCTV stream is not connected yet.</p>
              <div className="streamEmptyMeta">
                <span className="streamEmptyBadge">OFFLINE</span>
                <span className="streamEmptyDetails">Awaiting RTSP Input</span>
              </div>
              <button 
                type="button" 
                className="streamEmptyCta"
                title="Go to Cameras to configure RTSP streams"
                onClick={() => alert("Please navigate to the 'Cameras' menu in the sidebar to configure RTSP streams.")}
              >
                Configure Camera
              </button>
            </div>
            
            <div className="cameraTag">LINE {activeLine}</div>
          </div>

          {/* Recent Capture / Recent Detection Panel */}
          <div className="recentCapturePanel">
            <div className="recentCaptureHeader">
              <div>
                <h3>Recent Capture</h3>
                <p>Last detection snapshots from current inspection line</p>
              </div>
              <div className="recentCaptureFilters">
                {activeTruckSession && activeTruckSession.line === activeLine && (
                  <div className="truckFilterToggle" title="Filter to show captures only for the active truck session">
                    <label className="toggleSwitch">
                      <input 
                        type="checkbox" 
                        checked={filterActiveTruck} 
                        onChange={(e) => {
                          setFilterActiveTruck(e.target.checked);
                          setCapturePage(1);
                        }} 
                      />
                      <span className="toggleSlider" />
                    </label>
                    <span className="toggleLabel">Active Truck Only</span>
                  </div>
                )}
                <span className="recentCaptureCount">
                  Showing {visibleCapturesCount === 0 ? 0 : (currentPage - 1) * pageSize + 1}–{Math.min(visibleCapturesCount, currentPage * pageSize)} of {visibleCapturesCount}
                </span>
              </div>
            </div>

            {visibleCapturesCount === 0 ? (
              <div className="recentEmptyState">
                <div className="recentEmptyIcon">
                  <Camera size={24} />
                </div>
                <div>
                  <h4>No recent captures yet</h4>
                  {filterActiveTruck ? (
                    <p>No captures have been linked to the active truck inspection yet.</p>
                  ) : (
                    <p>Menunggu hasil deteksi dari kamera aktif.</p>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="recentCaptureGrid">
                  {visibleCaptures.map((item) => {
                    const itemImpurity = item.classes.daun + item.classes.pucuk + item.classes.sampah;
                    return (
                      <button 
                        type="button"
                        key={item.id} 
                        className="recentCaptureCard"
                        onClick={() => setSelectedCapture(item)}
                        title={`View capture detail for Batch #${item.id}`}
                        aria-label={`View capture detail for Batch #${item.id}`}
                      >
                        <div className="recentThumbnailWrapper">
                          {item.snapshot ? (
                            <img 
                              src={item.snapshot} 
                              alt={`Detection batch #${item.id}`} 
                              className="recentThumbnail" 
                            />
                          ) : (
                            <div className="recentThumbnailPlaceholder">
                              <Camera size={16} />
                              <span>No snapshot</span>
                            </div>
                          )}
                          <span className={`recentGradeBadge grade-${item.grade.replace('/', '-')}`}>
                            MBS {item.grade}
                          </span>
                        </div>
                        <div className="recentCaptureInfo">
                          <span className="recentTime" title={new Date(item.timestamp).toLocaleString()}>
                            <Clock size={10} />
                            {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                          <div className="recentStats">
                            <span title={`Impurity: ${itemImpurity.toFixed(2)}%`}>Imp: <strong>{itemImpurity.toFixed(1)}%</strong></span>
                            <span title={`Confidence: ${Math.round(item.confidence * 100)}%`}>Conf: <strong>{Math.round(item.confidence * 100)}%</strong></span>
                          </div>
                        </div>
                      </button>
                    );
                  })}

                  {placeholders.map((_, index) => (
                    <div key={`placeholder-${index}`} className="recentCaptureCardPlaceholder">
                      <div className="recentThumbnailPlaceholder">
                        <Camera size={16} className="placeholderCamIcon" />
                        <span>Waiting for capture</span>
                      </div>
                      <div className="recentPlaceholderInfo">
                        <span className="placeholderDot" />
                        <span>Idle Line Slot</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="recentCapturePagination">
                  <button
                    type="button"
                    onClick={() => setCapturePage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="paginationBtn"
                    aria-label="Previous recent capture page"
                    title="Previous Page"
                  >
                    Previous
                  </button>
                  <span className="paginationText">
                    Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setCapturePage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="paginationBtn"
                    aria-label="Next recent capture page"
                    title="Next Page"
                  >
                    Next
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        
        <aside className="analysisPanel">
          {/* Active Truck Inspection Card Panel */}
          <TruckInspectionPanel activeLine={activeLine} />
          {/* Inspection Session Details Card */}
          <div className="panelBlock sessionDetailsCard">
            <h2>Inspection Session</h2>
            <div className="sessionMetaGrid">
              <div className="sessionMetaRow">
                <div className="metaItem">
                  <span className="metaLabel">Active Target</span>
                  <strong>Meja / Line {activeLine}</strong>
                </div>
                <div className="metaItem">
                  <span className="metaLabel">Session Mode</span>
                  <span className="badgeBadge mode-live">
                    <Radio size={10} className="pulse-icon" />
                    LIVE RUN
                  </span>
                </div>
              </div>
              <div className="sessionMetaRow">
                <div className="metaItem">
                  <span className="metaLabel">Camera Source</span>
                  <code className="sessionCameraCode">rtsp://camera-line-{activeLine}:554/stream</code>
                </div>
                <div className="metaItem">
                  <span className="metaLabel">Last Scan</span>
                  <span className="sessionTime">
                    <Clock size={11} />
                    {latest ? new Date(latest.timestamp).toLocaleTimeString() : "No active scan"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <PanelBlock title="Kelas Label">
            <LegendItem color="green" title="daun" text="Daun kering / hijau, serpihan daun tebu" />
            <LegendItem color="yellow" title="pucuk" text="Pucuk tebu, daun muda, bunga" />
            <LegendItem color="red" title="sampah" text="Tanah, akar, plastik, batu, material non tebu" />
            <LegendItem color="gray" title="background" text="Batang tebu utama, tidak dihitung pengotor" />
          </PanelBlock>

          <PanelBlock title="Statistik Area">
            <div className="areaTable">
              <div className="areaHead">
                <span>Kelas</span>
                <span>Luas</span>
                <span>%</span>
              </div>
              {rows.map((row) => (
                <div className="areaRowWrap" key={row.name}>
                  <div className="areaRow">
                    <span><i className={`swatch ${row.color}`} />{row.name}</span>
                    <strong>{row.area.toLocaleString()} px</strong>
                    <strong>{row.percent.toFixed(2)}%</strong>
                  </div>
                  <div className="areaRowProgress">
                    <div 
                      className={`areaRowProgressBar ${row.color}`} 
                      style={{ width: `${row.percent}%` }} 
                    />
                  </div>
                </div>
              ))}
            </div>
          </PanelBlock>

          <div className="resultPanel">
            <span className="resultPanelTitle">Hasil Perhitungan</span>
            
            <div className="resultDetailsList">
              <div className="resultDetailRow">
                <span className="resultDetailLabel">Total Pengotor</span>
                <strong className="resultDetailValue impurityVal">{impurity.toFixed(2)}%</strong>
              </div>
              <div className="resultDetailRow">
                <span className="resultDetailLabel">Kategori Prediksi</span>
                <strong className={`resultDetailValue gradeVal grade-${grade}`}>MBS {grade}</strong>
              </div>
            </div>
            
            <div className="resultConfidenceRow">
              <div className="confidenceMeta">
                <span className="resultPanelConf">Confidence Score</span>
                <span className="confidencePercent">{Math.round(confidence * 100)}%</span>
              </div>
              <div className="confidenceBarWrap">
                <div className="confidenceBar" style={{ width: `${confidence * 100}%` }} />
              </div>
              <small className="resultPanelConf">Confidence: {confidence.toFixed(2)}</small>
            </div>
          </div>
        </aside>
      </div>

      <div className="dashboardFooterGrid">
        <div className="guidePanel">
          <h2>Panduan Label</h2>
          <div className="guideGrid">
            <GuideCard color="green" title="1. DAUN" text="Semua daun kering/hijau dan serpihan daun tebu." />
            <GuideCard color="yellow" title="2. PUCUK" text="Pucuk tebu, daun muda, dan bunga." />
            <GuideCard color="red" title="3. SAMPAH / KOTORAN" text="Tanah, sampah, akar, kayu, plastik, batu, dan material non tebu." />
            <GuideCard color="gray" title="BACKGROUND" text="Batang tebu tidak di-label. Area selain 3 kelas dianggap batang." />
          </div>
        </div>

        <div className="systemHealthSection">
          <span className="healthSectionTitle">System Flags</span>
          <div className="systemFlagsGrid">
            <div className={`healthIndicatorChip ${status?.backend.status === "ok" ? "ok" : "err"}`} title={`Backend ${status?.backend.status === "ok" ? "OK" : "CHECKING"}`}>
              <CheckCircle size={12} />
              <span className="truncate">Backend: {status?.backend.status === "ok" ? "OK" : "CHECKING"}</span>
            </div>
            <div className={`healthIndicatorChip ${status?.ai.status === "ok" ? "ok" : "err"}`} title={`AI Engine ${status?.ai.status === "ok" ? "OK" : "CHECKING"}`}>
              <CheckCircle size={12} />
              <span className="truncate">AI Engine: {status?.ai.status === "ok" ? "OK" : "CHECKING"}</span>
            </div>
            <div className={`healthIndicatorChip ${status?.database.status === "ok" ? "ok" : "err"}`} title={`Database ${status?.database.status === "ok" ? "OK" : "CHECKING"}`}>
              <CheckCircle size={12} />
              <span className="truncate">Database: {status?.database.status === "ok" ? "OK" : "CHECKING"}</span>
            </div>
            <div className="healthIndicatorChip info" title={`Edge Clients: ${status?.websocket.clients ?? 1} active`}>
              <Radio size={12} />
              <span className="truncate">Edge: {status?.websocket.clients ?? 1} active</span>
            </div>
            <div className="healthIndicatorChip warn" title={`Impurity Index: ${impurity.toFixed(2)}%`}>
              <Activity size={12} />
              <span className="truncate">Impurity: {impurity.toFixed(2)}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Capture Detail Modal Overlay */}
      {selectedCapture && (() => {
        const daun = selectedCapture.classes.daun ?? 0;
        const pucuk = selectedCapture.classes.pucuk ?? 0;
        const sampah = selectedCapture.classes.sampah ?? 0;
        const impurityVal = daun + pucuk + sampah;
        const bgVal = Math.max(0, 100 - impurityVal);
        const confPercent = Math.round(selectedCapture.confidence * 100);

        return (
          <div 
            className="modal-backdrop"
            onClick={() => setSelectedCapture(null)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="capture-detail-modal" onClick={(e) => e.stopPropagation()}>
              <div className="capture-detail-modal__header">
                <div>
                  <h2 id="modal-title">Capture Detail</h2>
                  <p>Detection result from recent capture</p>
                </div>
                <button 
                  type="button" 
                  className="modal-close-btn"
                  onClick={() => setSelectedCapture(null)}
                  aria-label="Close capture detail"
                  title="Close"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="capture-detail-modal__body">
                <div className="capture-detail-snapshot">
                  {selectedCapture.snapshot ? (
                    <div className="snapshot-preview-container">
                      <img src={selectedCapture.snapshot} alt={`Snapshot for Batch #${selectedCapture.id}`} className="snapshot-preview-img" />
                      <span className="snapshot-badge">Preview</span>
                    </div>
                  ) : (
                    <div className="no-snapshot-placeholder">
                      <Camera size={48} className="no-snapshot-icon" />
                      <h3>No Snapshot Available</h3>
                      <p>Snapshot image is not available for this capture yet.</p>
                    </div>
                  )}
                </div>

                <div className="capture-detail-info">
                  {/* Result summary */}
                  <div className="capture-detail-summary-card">
                    <div className="summary-left">
                      <span className="summary-label">PREDICTED GRADE</span>
                      <h2 className="summary-grade-val">MBS {selectedCapture.grade}</h2>
                    </div>
                    <div className="summary-right">
                      <div className="summary-stat-row">
                        <span>Impurity:</span>
                        <strong>{impurityVal.toFixed(1)}%</strong>
                      </div>
                      <div className="summary-stat-row">
                        <span>Confidence:</span>
                        <strong>{confPercent}%</strong>
                      </div>
                      <div className="summary-badge-wrapper">
                        <span className="summary-status-badge">Detection Record</span>
                      </div>
                    </div>
                  </div>

                  {/* Capture metadata */}
                  <div className="capture-info-section">
                    <h4 className="section-title">METADATA</h4>
                    <div className="info-grid">
                      <div className="capture-detail-row">
                        <span>Record ID</span>
                        <strong>Batch #{selectedCapture.id}</strong>
                      </div>
                      <div className="capture-detail-row">
                        <span>Timestamp</span>
                        <strong>{new Date(selectedCapture.timestamp).toLocaleString()}</strong>
                      </div>
                      <div className="capture-detail-row">
                        <span>Camera Input</span>
                        <strong>Camera {selectedCapture.cameraId || "-"}</strong>
                      </div>
                      <div className="capture-detail-row">
                        <span>Active Line</span>
                        <strong>Line {activeLine} (Operator Room)</strong>
                      </div>
                    </div>
                  </div>

                  {/* Class breakdown */}
                  <div className="capture-info-section">
                    <h4 className="section-title">CLASS BREAKDOWN</h4>
                    <div className="class-breakdown-list">
                      {/* Daun */}
                      <div className="class-bar-wrapper">
                        <div className="class-bar-info">
                          <span>Daun (Leaves)</span>
                          <strong>{daun.toFixed(1)}%</strong>
                        </div>
                        <div className="class-bar-track">
                          <div className="class-bar-fill class-green" style={{ width: `${daun}%` }} />
                        </div>
                      </div>

                      {/* Pucuk */}
                      <div className="class-bar-wrapper">
                        <div className="class-bar-info">
                          <span>Pucuk (Tops)</span>
                          <strong>{pucuk.toFixed(1)}%</strong>
                        </div>
                        <div className="class-bar-track">
                          <div className="class-bar-fill class-amber" style={{ width: `${pucuk}%` }} />
                        </div>
                      </div>

                      {/* Sampah */}
                      <div className="class-bar-wrapper">
                        <div className="class-bar-info">
                          <span>Sampah (Trash)</span>
                          <strong>{sampah.toFixed(1)}%</strong>
                        </div>
                        <div className="class-bar-track">
                          <div className="class-bar-fill class-red" style={{ width: `${sampah}%` }} />
                        </div>
                      </div>

                      {/* Background / Cane */}
                      <div className="class-bar-wrapper">
                        <div className="class-bar-info">
                          <span>Batang Tebu (Sugarcane)</span>
                          <strong>{bgVal.toFixed(1)}%</strong>
                        </div>
                        <div className="class-bar-track">
                          <div className="class-bar-fill class-gray" style={{ width: `${bgVal}%` }} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="capture-detail-modal__footer">
                <button 
                  type="button" 
                  className="modal-footer-btn secondary disabled-btn" 
                  disabled 
                  title="History filters integration is coming soon"
                >
                  View in History
                </button>
                <button 
                  type="button" 
                  className="modal-footer-btn primary" 
                  onClick={() => setSelectedCapture(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </section>
  );
}
