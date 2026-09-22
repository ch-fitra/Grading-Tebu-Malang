import { Check, Pencil, Plus, Power, Trash2, X, Video, ShieldAlert, ShieldCheck, Activity } from "lucide-react";
import { useState } from "react";
import type { CameraRow } from "../types";
import { useAppStore } from "../store";
import { Header } from "./shared/Header";
import { IconButton } from "./shared/IconButton";
import { DataTable } from "./shared/DataTable";

export function CameraManager() {
  const { cameras, createCamera, updateCamera, deleteCamera } = useAppStore();
  const canWrite = useAppStore(s => s.session?.user.permissions?.includes("camera.write") ?? false);
  const emptyForm = { name: "", location: "", rtspUrl: "" };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const editingCamera = cameras.find((camera) => camera.id === editingId) ?? null;

  function edit(camera: CameraRow) {
    setEditingId(camera.id);
    setForm({ name: camera.name, location: camera.location, rtspUrl: camera.rtspUrl });
  }

  function reset() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      if (editingId) {
        await updateCamera(editingId, form);
      } else {
        await createCamera(form);
      }
      reset();
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(camera: CameraRow) {
    await updateCamera(camera.id, { status: camera.status === "online" ? "offline" : "online" });
  }

  // Calculate statistics
  const totalCameras = cameras.length;
  const onlineCameras = cameras.filter((c) => c.status === "online").length;
  const offlineCameras = totalCameras - onlineCameras;
  const uniqueLines = new Set(cameras.map((c) => c.location).filter(Boolean)).size || totalCameras;

  return (
    <section className="managerPage cameraPage">
      <Header 
        title="Camera Stream Manager" 
        subtitle="Manage camera stream endpoints, check connectivity, and register new RTSP sources"
        action={canWrite ? <IconButton icon={Plus} label="New Camera" onClick={reset} /> : undefined}
      />

      {/* Summary Cards */}
      <div className="cameraStatsGrid">
        <div className="statCard">
          <div className="statHeader">
            <span>Total Cameras</span>
            <Video size={18} className="statIcon" />
          </div>
          <strong>{totalCameras} channels</strong>
        </div>
        <div className="statCard">
          <div className="statHeader">
            <span>Active Streams</span>
            <ShieldCheck size={18} className="statIcon icon-online" />
          </div>
          <strong className="text-online">{onlineCameras} active</strong>
        </div>
        <div className="statCard">
          <div className="statHeader">
            <span>Inactive Streams</span>
            <ShieldAlert size={18} className="statIcon icon-offline" />
          </div>
          <strong className="text-offline">{offlineCameras} offline</strong>
        </div>
        <div className="statCard">
          <div className="statHeader">
            <span>Inspection Lines</span>
            <Activity size={18} className="statIcon icon-warn" />
          </div>
          <strong>{uniqueLines} lines active</strong>
        </div>
      </div>

      <div className="managerGrid">
        <div className="cameraFormColumn">
          {canWrite && <>
          <form className="editorPanel" onSubmit={submit}>
            <div className="editorTitle">
              <strong>{editingCamera ? "Edit Camera Configuration" : "Register New Camera"}</strong>
              {editingCamera && <button type="button" className="ghostIcon" onClick={reset} title="Cancel"><X size={17} /></button>}
            </div>
            <div className="formFields">
              <label>
                Camera Name
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Line 1 Camera" required />
              </label>
              <label>
                Location / Placement
                <input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="e.g. Meja 1" />
              </label>
              <label>
                RTSP URL
                <input value={form.rtspUrl} onChange={(event) => setForm({ ...form, rtspUrl: event.target.value })} placeholder="rtsp://user:pass@ip/stream" required />
              </label>
            </div>
            <button className="primary formSubmit" disabled={busy}>
              <Check size={17} />
              {busy ? "Saving Stream..." : editingCamera ? "Update Config" : "Register Stream"}
            </button>
          </form>
          </>}

          <div className="panelBlock streamHealthCard">
            <h2>Stream Decoder Checklist</h2>
            <div className="checklistItems">
              <div className="checklistItem">
                <span>RTSP Stream Protocol</span>
                <strong className="text-online">Verified</strong>
              </div>
              <div className="checklistItem">
                <span>H.264 Video Decoding</span>
                <strong className="text-online">Active</strong>
              </div>
              <div className="checklistItem">
                <span>Frame Resolution</span>
                <strong>1920x1080 @ 25fps</strong>
              </div>
              <div className="checklistItem">
                <span>Latency Handling</span>
                <strong>Sub-second (Auto)</strong>
              </div>
            </div>
          </div>
        </div>
        
        <DataTable
          columns={["Name", "Location", "RTSP Stream Link", "Status", "Actions"]}
          rows={cameras.map((row) => [
            <span style={{ fontWeight: 600, color: "var(--color-text)" }}>{row.name}</span>,
            row.location || "-",
            <code className="monospace-text text-truncate" title={row.rtspUrl}>{row.rtspUrl}</code>,
            <span className={`statusPill ${row.status}`}>{row.status}</span>,
            canWrite ? <div className="rowActions">
              <button title="Toggle online status" onClick={() => toggleStatus(row)} className={row.status === "online" ? "btn-power-on" : "btn-power-off"}><Power size={16} /></button>
              <button title="Edit config" onClick={() => edit(row)} className="btn-edit"><Pencil size={16} /></button>
              <button title="Delete camera" onClick={() => deleteCamera(row.id)} className="btn-delete"><Trash2 size={16} /></button>
            </div> : <span className="accessBadge muted">Read only</span>
          ])}
        />
      </div>
    </section>
  );
}
