import { useState, useEffect } from "react";
import { Archive, Calendar, Camera, Filter, Search, Sliders, X } from "lucide-react";
import { useAppStore } from "../store";
import { downloadCsv } from "../utils/csv";
import { Header } from "./shared/Header";
import { IconButton } from "./shared/IconButton";
import { DataTable } from "./shared/DataTable";
import { TruckInspectionDetailModal } from "./TruckInspectionDetailModal";
import type { TruckInspectionSession, InferenceResult } from "../types";

export function HistoryPage() {
  const { history, truckSessions, deleteTruckInspection } = useAppStore();
  const canWrite = useAppStore(s => s.session?.user.permissions?.includes("inspection.write") ?? false);
  const [activeTab, setActiveTab] = useState<"trucks" | "captures">("trucks");
  const [selectedTruckSession, setSelectedTruckSession] = useState<TruckInspectionSession | null>(null);
  const [selectedCapture, setSelectedCapture] = useState<InferenceResult | null>(null);

  // Close modals on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedCapture(null);
        setSelectedTruckSession(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function exportCsv() {
    const header = ["Time", "Camera", "Grade", "Daun", "Pucuk", "Sampah", "Confidence"];
    const body = history.map((row) => [
      new Date(row.timestamp).toLocaleString(),
      `#${row.cameraId}`,
      row.grade,
      row.classes.daun,
      row.classes.pucuk,
      row.classes.sampah,
      row.confidence
    ]);
    downloadCsv("tebu-history.csv", [header, ...body]);
  }

  function exportTruckCsv() {
    const header = ["Truck Code", "Plate Number", "Line", "Started At", "Completed At", "Cycles", "Avg Impurity", "Avg Confidence", "Final Decision", "Status"];
    const body = truckSessions.map((row) => [
      row.truckCode,
      row.plateNumber || "",
      `Line ${row.line}`,
      new Date(row.startedAt).toLocaleString(),
      row.completedAt ? new Date(row.completedAt).toLocaleString() : "Active",
      row.totalCaptures,
      `${row.averageImpurity.toFixed(2)}%`,
      `${Math.round(row.averageConfidence * 100)}%`,
      row.finalDecision.replace("_", " "),
      row.status
    ]);
    downloadCsv("tebu-truck-history.csv", [header, ...body]);
  }

  const getDecisionBadge = (decision: string) => {
    switch (decision) {
      case "MBS":
        return <span className="decision-badge mbs">MBS</span>;
      case "NON_MBS":
        return <span className="decision-badge non-mbs">Non MBS</span>;
      case "DITOLAK_DO":
        return <span className="decision-badge reject">Ditolak / DO</span>;
      default:
        return <span className="decision-badge pending">Pending</span>;
    }
  };

  // Calculate summary stats
  const totalRecords = history.length;
  const lastInference = totalRecords > 0 
    ? new Date(history[0].timestamp).toLocaleTimeString() 
    : "-";
  const averageConfidence = totalRecords > 0
    ? `${Math.round((history.reduce((sum, row) => sum + row.confidence, 0) / totalRecords) * 100)}%`
    : "-";
  const averageImpurity = totalRecords > 0
    ? `${(history.reduce((sum, row) => sum + (row.classes.daun + row.classes.pucuk + row.classes.sampah), 0) / totalRecords).toFixed(2)}%`
    : "-";

  return (
    <section className="historyPage">
      <Header 
        title="History Log" 
        subtitle="Archived history of sugar cane quality inspection records" 
        action={
          <IconButton 
            icon={Archive} 
            label="Export" 
            onClick={activeTab === "trucks" ? exportTruckCsv : exportCsv} 
          />
        } 
      />

      {/* Tabs Switcher Toolbar */}
      <div className="historyTabContainer">
        <button 
          className={`historyTabBtn ${activeTab === "trucks" ? "active" : ""}`}
          onClick={() => setActiveTab("trucks")}
        >
          🚚 Truck History
        </button>
        <button 
          className={`historyTabBtn ${activeTab === "captures" ? "active" : ""}`}
          onClick={() => setActiveTab("captures")}
        >
          🗂️ Detection Records
        </button>
      </div>

      {/* Summary Stats Cards */}
      <div className="historyStatsGrid">
        <div className="statCard">
          <span>Total Batches</span>
          <strong>{totalRecords} batches</strong>
        </div>
        <div className="statCard">
          <span>Last Inference</span>
          <strong>{lastInference}</strong>
        </div>
        <div className="statCard">
          <span>Average Confidence</span>
          <strong>{averageConfidence}</strong>
        </div>
        <div className="statCard">
          <span>Average Impurity</span>
          <strong>{averageImpurity}</strong>
        </div>
      </div>

      {/* Visual Filter UI */}
      <div className="filterToolbar">
        <div className="filterGroup">
          <div className="filterInputWrapper">
            <Search size={16} />
            <input type="text" placeholder="Search batch ID..." disabled />
          </div>
          <div className="filterInputWrapper">
            <Calendar size={16} />
            <input type="text" placeholder="Select date range..." disabled />
          </div>
          <div className="filterInputWrapper">
            <Camera size={16} />
            <select disabled style={{ border: "none", background: "transparent", outline: "none", width: "100%", font: "inherit", color: "inherit" }}>
              <option>All Cameras</option>
            </select>
          </div>
          <div className="filterInputWrapper">
            <Filter size={16} />
            <select disabled style={{ border: "none", background: "transparent", outline: "none", width: "100%", font: "inherit", color: "inherit" }}>
              <option>All Grades</option>
            </select>
          </div>
        </div>
        <button className="filterResetButton" disabled>
          <Sliders size={15} />
          Reset Filters
        </button>
      </div>

      {activeTab === "trucks" ? (
        truckSessions.length === 0 ? (
          <div className="emptyStatePanel">
            <div className="emptyStateIcon">🚚</div>
            <h3>No truck inspections yet</h3>
            <p>Start a truck inspection session from the Dashboard to group grading cycles.</p>
          </div>
        ) : (
          <DataTable
            columns={[
              "Truck Code",
              "Plate Number",
              "Line",
              "Started At",
              "Completed At",
              "Cycles",
              "Avg Impurity",
              "Avg Confidence",
              "Decision",
              "Status",
              "Actions"
            ]}
            rows={truckSessions.map((row) => [
              <span style={{ fontWeight: 700, color: "var(--color-text)" }}>{row.truckCode}</span>,
              <span>{row.plateNumber || "-"}</span>,
              <strong style={{ color: "var(--color-text)" }}>Line {row.line}</strong>,
              <span>{new Date(row.startedAt).toLocaleString()}</span>,
              <span>{row.completedAt ? new Date(row.completedAt).toLocaleString() : "-"}</span>,
              <strong>{row.totalCaptures} cycles</strong>,
              <span className={row.averageImpurity > 20 ? "text-danger" : row.averageImpurity > 10 ? "text-amber" : "text-success"} style={{ fontWeight: 600 }}>
                {row.averageImpurity.toFixed(1)}%
              </span>,
              <span>{Math.round(row.averageConfidence * 100)}%</span>,
              getDecisionBadge(row.finalDecision),
              <span className={`session-status-badge ${row.status}`}>
                {row.status.toUpperCase()}
              </span>,
              <div className="table-action-row">
                <button 
                  type="button" 
                  className="view-cycle-btn"
                  onClick={() => setSelectedTruckSession(row)}
                >
                  View
                </button>
                {canWrite && <button 
                  type="button" 
                  className="view-cycle-btn btn-danger"
                  style={{ marginLeft: 8 }}
                  onClick={() => {
                    if (confirm(`Are you sure you want to delete inspection record for truck ${row.truckCode}?`)) {
                      void deleteTruckInspection(row.id).catch(error => alert(`Gagal menghapus inspeksi: ${error}`));
                    }
                  }}
                >
                  Delete
                </button>}
              </div>
            ])}
          />
        )
      ) : (
        history.length === 0 ? (
          <div className="emptyStatePanel">
            <div className="emptyStateIcon">🗂️</div>
            <h3>No grading records yet</h3>
            <p>Hubungkan kamera aktif untuk menghasilkan catatan deteksi nyata.</p>
          </div>
        ) : (
          <DataTable
            columns={["Time", "Camera", "Grade", "Daun", "Pucuk", "Sampah", "Confidence"]}
            rows={history.map((row) => [
              new Date(row.timestamp).toLocaleString(),
              <span style={{ fontWeight: 600, color: "var(--color-text)" }}>#{row.cameraId}</span>,
              <span className={`gradePill grade-${row.grade}`}>{row.grade}</span>,
              <span className="percentText green">{row.classes.daun}%</span>,
              <span className="percentText yellow">{row.classes.pucuk}%</span>,
              <span className="percentText red">{row.classes.sampah}%</span>,
              <div className="confidenceCell">
                <span>{Math.round(row.confidence * 100)}%</span>
                <div className="confidenceBarWrap mini">
                  <div className="confidenceBar" style={{ width: `${row.confidence * 100}%` }} />
                </div>
              </div>
            ])}
          />
        )
      )}

      {/* Truck Session Detail Modal */}
      {selectedTruckSession && (
        <TruckInspectionDetailModal
          session={selectedTruckSession}
          history={history}
          onClose={() => setSelectedTruckSession(null)}
          onViewCapture={(cap) => setSelectedCapture(cap)}
        />
      )}

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
            aria-labelledby="capture-modal-title"
            style={{ zIndex: 10000 }}
          >
            <div className="capture-detail-modal" onClick={(e) => e.stopPropagation()}>
              <div className="capture-detail-modal__header">
                <div>
                  <h2 id="capture-modal-title">Capture Detail</h2>
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
