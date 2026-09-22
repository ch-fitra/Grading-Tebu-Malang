import { useState } from "react";
import { X, Clock, Calendar, User, FileText, Camera } from "lucide-react";
import type { TruckInspectionSession, InferenceResult } from "../types";

interface TruckInspectionDetailModalProps {
  session: TruckInspectionSession;
  history: InferenceResult[];
  onClose: () => void;
  onViewCapture: (capture: InferenceResult) => void;
}

export function TruckInspectionDetailModal({ session, history, onClose, onViewCapture }: TruckInspectionDetailModalProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 5;

  // Filter history records belonging to this session
  const sessionCaptures = history.filter(item => session.captureIds.includes(item.id));
  
  // Sort captures by timestamp ascending to determine cycle order
  const sortedCaptures = [...sessionCaptures].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const totalPages = Math.max(1, Math.ceil(sortedCaptures.length / pageSize));
  const pageIndex = Math.min(currentPage, totalPages);
  const visibleCaptures = sortedCaptures.slice((pageIndex - 1) * pageSize, pageIndex * pageSize);

  // Formatting duration helper
  const getDuration = () => {
    const end = session.completedAt ? new Date(session.completedAt).getTime() : Date.now();
    const start = new Date(session.startedAt).getTime();
    const diff = end - start;
    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return `${mins}m ${secs}s`;
  };

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

  return (
    <div 
      className="modal-backdrop" 
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title-truck-detail"
    >
      <div 
        className="capture-detail-modal truck-detail-modal" 
        onClick={(e) => e.stopPropagation()}
      >
        <div className="capture-detail-modal__header">
          <div>
            <h2 id="modal-title-truck-detail">Truck Inspection Detail</h2>
            <p>Inspection session code: {session.id}</p>
          </div>
          <button 
            type="button" 
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close detail modal"
            title="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="capture-detail-modal__body truck-detail-body">
          {/* Main overview grid */}
          <div className="truck-detail-grid-row">
            {/* Left side stats summary */}
            <div className="truck-summary-cards-container">
              <div className="truck-large-summary-card">
                <div className="summary-left">
                  <span className="summary-label">FINAL DECISION</span>
                  <div style={{ marginTop: 8 }}>
                    {getDecisionBadge(session.finalDecision)}
                  </div>
                </div>
                <div className="summary-right">
                  <div className="summary-stat-row">
                    <span>Cycles:</span>
                    <strong>{session.totalCaptures}</strong>
                  </div>
                  <div className="summary-stat-row">
                    <span>Avg Impurity:</span>
                    <strong className={session.averageImpurity > 20 ? "text-danger" : session.averageImpurity > 10 ? "text-amber" : "text-success"}>
                      {session.averageImpurity.toFixed(1)}%
                    </strong>
                  </div>
                  <div className="summary-stat-row">
                    <span>Confidence:</span>
                    <strong>{Math.round(session.averageConfidence * 100)}%</strong>
                  </div>
                </div>
              </div>

              {/* Metadata columns */}
              <div className="truck-detail-section">
                <h4 className="section-title">TRUCK & INSPECTOR METADATA</h4>
                <div className="info-grid text-sm">
                  <div className="capture-detail-row">
                    <span>Truck ID / Code</span>
                    <strong>{session.truckCode}</strong>
                  </div>
                  <div className="capture-detail-row">
                    <span>Plate Number</span>
                    <strong>{session.plateNumber || "-"}</strong>
                  </div>
                  <div className="capture-detail-row">
                    <span>Driver Name</span>
                    <strong>{session.driverName || "-"}</strong>
                  </div>
                  <div className="capture-detail-row">
                    <span>Supplier / Vendor</span>
                    <strong>{session.supplier || "-"}</strong>
                  </div>
                  <div className="capture-detail-row">
                    <span>Inspection Line</span>
                    <strong>Line {session.line}</strong>
                  </div>
                  <div className="capture-detail-row">
                    <span>Started At</span>
                    <strong>{new Date(session.startedAt).toLocaleString()}</strong>
                  </div>
                  {session.completedAt && (
                    <div className="capture-detail-row">
                      <span>Completed At</span>
                      <strong>{new Date(session.completedAt).toLocaleString()}</strong>
                    </div>
                  )}
                  <div className="capture-detail-row">
                    <span>Duration</span>
                    <strong>{getDuration()}</strong>
                  </div>
                </div>
              </div>

              {/* Decision threshold description */}
              <div className="truck-detail-section">
                <h4 className="section-title">DECISION RULE EXPLANATION</h4>
                <div className="decision-explanation-card">
                  <p>
                    Final decision calculated based on client impurity guidelines across all {session.totalCaptures} grading cycles:
                  </p>
                  <ul className="threshold-rules-list">
                    <li>Impurity &le; 10% &rarr; <strong>MBS</strong></li>
                    <li>Impurity 10% - 20% &rarr; <strong>Non MBS</strong></li>
                    <li>Impurity &gt; 20% &rarr; <strong>Ditolak / DO</strong></li>
                  </ul>
                  <div className="explanation-result">
                    Average Impurity: <strong>{session.averageImpurity.toFixed(2)}%</strong>. 
                    Result: <strong>{session.finalDecision.replace("_", " ")}</strong>.
                  </div>
                </div>
              </div>

              {session.notes && (
                <div className="truck-detail-section">
                  <h4 className="section-title">SESSION NOTES</h4>
                  <div className="notes-display-box">
                    <FileText size={14} style={{ marginRight: 6, flexShrink: 0, marginTop: 2 }} />
                    <p>{session.notes}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Right side associated captures log */}
            <div className="truck-cycles-log-container">
              <h4 className="section-title">DETECTION CYCLES ({sortedCaptures.length})</h4>
              
              {sortedCaptures.length === 0 ? (
                <div className="no-cycles-box">
                  <Camera size={24} />
                  <p>No detection cycles associated with this truck session yet.</p>
                </div>
              ) : (
                <div className="cycles-list-wrapper">
                  <div className="cycles-table-overflow">
                    <table className="cycles-log-table">
                      <thead>
                        <tr>
                          <th>Cycle</th>
                          <th>Time</th>
                          <th>Grade</th>
                          <th>Impurity</th>
                          <th>Conf</th>
                          <th style={{ textAlign: "right" }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleCaptures.map((item, index) => {
                          const cycleNumber = (pageIndex - 1) * pageSize + index + 1;
                          const impurity = item.classes.daun + item.classes.pucuk + item.classes.sampah;
                          return (
                            <tr key={item.id}>
                              <td><strong>Cycle #{cycleNumber}</strong></td>
                              <td>{new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                              <td>
                                <span className={`table-grade-badge grade-${item.grade.replace("/", "-")}`}>
                                  {item.grade}
                                </span>
                              </td>
                              <td className={impurity > 20 ? "text-danger" : impurity > 10 ? "text-amber" : "text-success"}>
                                {impurity.toFixed(1)}%
                              </td>
                              <td>{Math.round(item.confidence * 100)}%</td>
                              <td style={{ textAlign: "right" }}>
                                <button 
                                  type="button"
                                  className="view-cycle-btn"
                                  onClick={() => onViewCapture(item)}
                                >
                                  View Detail
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {totalPages > 1 && (
                    <div className="recentCapturePagination table-pagination">
                      <button
                        type="button"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={pageIndex === 1}
                        className="paginationBtn"
                      >
                        Previous
                      </button>
                      <span className="paginationText">
                        Page <strong>{pageIndex}</strong> of <strong>{totalPages}</strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={pageIndex === totalPages}
                        className="paginationBtn"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="capture-detail-modal__footer">
          <button 
            type="button" 
            className="modal-footer-btn primary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
