import { Check, Upload, Cpu, Award } from "lucide-react";
import { useAppStore } from "../store";
import { Header } from "./shared/Header";
import { IconButton } from "./shared/IconButton";
import { DataTable } from "./shared/DataTable";

export function ModelManager() {
  const { models, activateModel } = useAppStore();
  const canWrite = useAppStore(s => s.session?.user.permissions?.includes("model.write") ?? false);
  
  // Find currently active model
  const activeModel = models.find((m) => m.active);

  return (
    <section className="modelPage">
      <Header 
        title="AI Model Manager" 
        subtitle="Manage local ONNX neural network files, select default classifiers, and deploy to active grading lines"
        action={canWrite ? <IconButton icon={Upload} label="Upload Model" /> : undefined}
      />

      {models.length === 0 ? (
        <div className="emptyStatePanel">
          <div className="emptyStateIcon">🧠</div>
          <h3>No AI Models Configured</h3>
          <p>Upload a trained ONNX classification model file to start grading cane batches.</p>
        </div>
      ) : (
        <>
          {/* Active Model Status Card */}
          {activeModel && (
            <div className="activeModelSection">
              <div className="activeModelCard">
                <div className="activeModelCardHeader">
                  <div className="modelTitleGroup">
                    <Cpu size={24} className="modelTitleIcon" />
                    <div>
                      <h3>{activeModel.name}</h3>
                      <span>Version {activeModel.version}</span>
                    </div>
                  </div>
                  <div className="activeModelBadge">
                    <Award size={16} />
                    Active Production Model
                  </div>
                </div>
                <div className="activeModelCardBody">
                  <div className="modelDetailItem">
                    <span>Model File Path</span>
                    <code className="text-truncate" title={activeModel.path}>{activeModel.path}</code>
                  </div>
                  <div className="modelDetailItem">
                    <span>Status</span>
                    <strong className="status-ready">Ready for Inference</strong>
                  </div>
                </div>
              </div>

              {/* Model Capabilities Grid */}
              <div className="modelCapabilitiesGrid">
                <div className="capabilityCard">
                  <span>Inference Engine</span>
                  <strong>ONNX Runtime v1.16</strong>
                </div>
                <div className="capabilityCard">
                  <span>Precision Target</span>
                  <strong>FP32 Floating-Point</strong>
                </div>
                <div className="capabilityCard">
                  <span>Input Dimensions</span>
                  <strong>640 x 640 px</strong>
                </div>
                <div className="capabilityCard">
                  <span>Target Classes</span>
                  <strong title="Daun, Pucuk, Sampah, Batang">4 categories</strong>
                </div>
              </div>
            </div>
          )}

          <div className="sectionHeader">
            <h3>Available Models Archive</h3>
            <p>List of trained ONNX models available for local classification tasks.</p>
          </div>

          <DataTable
            columns={["Name", "Version", "Path", "Active Status", "Actions"]}
            rows={models.map((row) => [
              <span style={{ fontWeight: 600, color: "var(--color-text)" }}>{row.name}</span>,
              row.version,
              <code className="monospace-text text-truncate" title={row.path}>{row.path}</code>,
              row.active ? (
                <span className="statusPill online">active</span>
              ) : (
                <span className="statusPill offline">inactive</span>
              ),
              <div className="rowActions">
                {canWrite ? <button 
                  title="Activate model" 
                  disabled={row.active} 
                  onClick={() => activateModel(row.id)}
                  className={row.active ? "btn-activate-disabled" : "btn-activate"}
                >
                  <Check size={16} />
                  {row.active ? "Active" : "Activate"}
                </button> : <span className="accessBadge muted">Read only</span>}
              </div>
            ])}
          />
        </>
      )}
    </section>
  );
}
