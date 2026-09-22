import { Activity, Server, Cpu, HardDrive, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import { useAppStore } from "../store";
import { Header } from "./shared/Header";
import { IconButton } from "./shared/IconButton";
import { DataTable } from "./shared/DataTable";
import { ThemePreference } from "./shared/ThemeToggle";

export function SettingsPage() {
  const { status } = useAppStore();
  const settings = useMemo(
    () => [
      ["Storage", <code className="monospace-text text-truncate" title="storage/snapshots">storage/snapshots</code>],
      ["Inference Interval", <code className="monospace-text">2000 ms</code>],
      ["GPU", <code className="monospace-text">CPUExecutionProvider</code>],
      ["AI Model", <code className="monospace-text text-truncate" title={status?.ai.model?.name ?? "Waiting for AI service"}>{status?.ai.model?.name ?? "Waiting for AI service"}</code>]
    ],
    [status]
  );

  return (
    <section className="settingsPage">
      <Header 
        title="System Settings" 
        subtitle="Review system-wide storage variables, inference speed configurations, and device accelerators"
        action={<IconButton icon={Activity} label="Verify System" />} 
      />

      <ThemePreference />

      {/* Grouped settings info cards */}
      <div className="settingsCardsGrid">
        <div className="settingSectionCard">
          <div className="cardHeader">
            <HardDrive size={18} className="cardHeaderIcon" />
            <h4>Storage Location</h4>
          </div>
          <p className="cardText">Folder destination where camera frame snapshots and system analysis logs are saved.</p>
          <div className="cardMeta">
            <span>Snapshot Path</span>
            <code>storage/snapshots</code>
          </div>
        </div>

        <div className="settingSectionCard">
          <div className="cardHeader">
            <Activity size={18} className="cardHeaderIcon" />
            <h4>Inference Engine</h4>
          </div>
          <p className="cardText">Delay time interval between each consecutive neural network classification run.</p>
          <div className="cardMeta">
            <span>Interval Rate</span>
            <code>2000 ms</code>
          </div>
        </div>

        <div className="settingSectionCard">
          <div className="cardHeader">
            <Cpu size={18} className="cardHeaderIcon" />
            <h4>Hardware Accelerator</h4>
          </div>
          <p className="cardText">ONNX Runtime execution provider utilized to run parallel mathematical operations.</p>
          <div className="cardMeta">
            <span>Provider</span>
            <code>CPUExecutionProvider</code>
          </div>
        </div>

        <div className="settingSectionCard">
          <div className="cardHeader">
            <ShieldCheck size={18} className="cardHeaderIcon" />
            <h4>Active Classifier</h4>
          </div>
          <p className="cardText">The machine learning model currently selected to identify sugarcane impurity rates.</p>
          <div className="cardMeta">
            <span>Active Model</span>
            <strong>{status?.ai.model?.name ?? "Waiting for AI service..."}</strong>
          </div>
        </div>
      </div>

      <div className="sectionHeader" style={{ marginTop: "16px" }}>
        <h3>Raw Configuration Table</h3>
        <p>Direct view of application key-value configurations loaded from environments.</p>
      </div>

      <DataTable columns={["Setting Property", "Active Value"]} rows={settings} />
    </section>
  );
}
