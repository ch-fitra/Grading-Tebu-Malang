import { useState, useEffect } from "react";
import { useAppStore } from "../store";
import { Truck, Play, CheckCircle, Clock, ShieldAlert, FileText } from "lucide-react";
import { StartTruckInspectionModal } from "./StartTruckInspectionModal";

interface TruckInspectionPanelProps {
  activeLine: number;
}

export function TruckInspectionPanel({ activeLine }: TruckInspectionPanelProps) {
  const { truckSessions, startTruckInspection, completeTruckInspection } = useAppStore();
  const activeTruckSession = truckSessions.find(session => session.status === "active" && session.line === activeLine) ?? null;
  const canWrite = useAppStore(s => s.session?.user.permissions?.includes("inspection.write") ?? false);
  const [showStartModal, setShowStartModal] = useState(false);
  const [duration, setDuration] = useState("0m 0s");

  // Keep duration ticker active when session is running
  useEffect(() => {
    if (!activeTruckSession || activeTruckSession.line !== activeLine) {
      setDuration("0m 0s");
      return;
    }
    const updateTicker = () => {
      const elapsed = Date.now() - new Date(activeTruckSession.startedAt).getTime();
      const mins = Math.floor(elapsed / 60000);
      const secs = Math.floor((elapsed % 60000) / 1000);
      setDuration(`${mins}m ${secs}s`);
    };
    updateTicker();
    const timer = setInterval(updateTicker, 1000);
    return () => clearInterval(timer);
  }, [activeTruckSession, activeLine]);

  const hasActiveSessionOnLine = activeTruckSession && activeTruckSession.line === activeLine;

  const handleStartSubmit = (data: {
    truckCode: string;
    plateNumber?: string;
    driverName?: string;
    supplier?: string;
    line: number;
    notes?: string;
  }) => {
    void startTruckInspection(data).then(() => setShowStartModal(false)).catch(error => alert(`Gagal memulai inspeksi: ${error}`));
  };

  const handleComplete = () => {
    const notesPrompt = prompt("Add final inspection notes (optional):", activeTruckSession?.notes || "");
    if (notesPrompt !== null) {
      if (activeTruckSession) void completeTruckInspection(activeTruckSession.id, notesPrompt).catch(error => alert(`Gagal menyelesaikan inspeksi: ${error}`));
    }
  };

  // Helper for decision pill classes
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
    <div className="truckInspectionPanelCard">
      <div className="truckPanelHeader">
        <div className="panelTitleRow">
          <Truck size={18} className="panelHeaderIcon" />
          <h3>Active Truck Inspection</h3>
        </div>
        {hasActiveSessionOnLine ? (
          <span className="sessionStatusBadge active">ACTIVE SESSION</span>
        ) : (
          <span className="sessionStatusBadge idle">IDLE</span>
        )}
      </div>

      {!hasActiveSessionOnLine ? (
        <div className="truckPanelEmpty">
          <div className="truckEmptyIconWrap">
            <Truck size={32} />
          </div>
          <h4>No Active Truck Session</h4>
          <p>Register and start an inspection session to associate incoming grading captures with a specific delivery truck.</p>
          {canWrite && <button 
            type="button" 
            className="startInspectionBtn"
            onClick={() => setShowStartModal(true)}
          >
            <Play size={12} style={{ marginRight: 6 }} />
            Start Truck Inspection
          </button>}
        </div>
      ) : (
        <div className="truckPanelActive">
          <div className="truckActiveHeader">
            <div className="truckNameGrid">
              <span className="truckCode" title={activeTruckSession.truckCode}>
                {activeTruckSession.truckCode}
              </span>
              {activeTruckSession.plateNumber && (
                <span className="truckPlate" title={activeTruckSession.plateNumber}>
                  [{activeTruckSession.plateNumber}]
                </span>
              )}
            </div>
            {getDecisionBadge(activeTruckSession.finalDecision)}
          </div>

          <div className="truckMetaGrid">
            {activeTruckSession.driverName && (
              <div className="truckMetaItem">
                <span>Driver:</span>
                <strong>{activeTruckSession.driverName}</strong>
              </div>
            )}
            {activeTruckSession.supplier && (
              <div className="truckMetaItem">
                <span>Supplier:</span>
                <strong title={activeTruckSession.supplier}>{activeTruckSession.supplier}</strong>
              </div>
            )}
            <div className="truckMetaItem">
              <span>Started At:</span>
              <strong>{new Date(activeTruckSession.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong>
            </div>
            <div className="truckMetaItem">
              <span>Duration:</span>
              <strong className="durationTicker">
                <Clock size={10} style={{ marginRight: 4 }} />
                {duration}
              </strong>
            </div>
          </div>

          {activeTruckSession.notes && (
            <div className="truckNotesBox">
              <FileText size={12} style={{ marginRight: 6, flexShrink: 0, marginTop: 2 }} />
              <p>{activeTruckSession.notes}</p>
            </div>
          )}

          <div className="truckStatsPanel">
            <div className="truckStatItem">
              <span className="statLabel">CYCLES</span>
              <span className="statVal">{activeTruckSession.totalCaptures}</span>
            </div>
            <div className="truckStatItem">
              <span className="statLabel">AVG IMPURITY</span>
              <span className={`statVal ${activeTruckSession.averageImpurity > 20 ? "text-danger" : activeTruckSession.averageImpurity > 10 ? "text-amber" : "text-success"}`}>
                {activeTruckSession.averageImpurity.toFixed(1)}%
              </span>
            </div>
            <div className="truckStatItem">
              <span className="statLabel">AVG CONFIDENCE</span>
              <span className="statVal">
                {Math.round(activeTruckSession.averageConfidence * 100)}%
              </span>
            </div>
          </div>

          {canWrite && <div className="truckActionRow">
            <button 
              type="button" 
              className="completeInspectionBtn"
              onClick={handleComplete}
            >
              <CheckCircle size={12} style={{ marginRight: 6 }} />
              Complete Inspection
            </button>
          </div>}
        </div>
      )}

      {showStartModal && (
        <StartTruckInspectionModal 
          line={activeLine}
          onClose={() => setShowStartModal(false)}
          onSubmit={handleStartSubmit}
        />
      )}
    </div>
  );
}
