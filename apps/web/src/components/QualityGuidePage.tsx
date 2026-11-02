import { Maximize2, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { usePanelSize } from "../hooks/usePanelSize";
import { KEBONAGUNG_GRADES, type KebonAgungGradeItem } from "../utils/grade-guide";
import { Header } from "./shared/Header";
import "./QualityGuidePage.css";

export function QualityGuidePage() {
  const size = usePanelSize<HTMLDivElement>();
  const [selected, setSelected] = useState<KebonAgungGradeItem | null>(null);
  const columns = size.width >= 1000 ? 4 : 2;
  const rows = Math.ceil(KEBONAGUNG_GRADES.length / columns);
  const cardHeight = (size.height - (rows - 1) * 10) / rows;
  const compact = cardHeight < 300 || size.width / columns < 260;
  const dense = cardHeight < 170;
  return (
    <section className="qualityWorkspace fixedWorkspace" data-compact={compact} data-dense={dense}>
      <Header title="Panduan Mutu" subtitle={size.width < 620 ? "PG Kebon Agung · Malang" : "PT Kebon Agung · Unit PG Kebon Agung, Malang"} action={<span className="workspacePill" title="Referensi klasifikasi; rafaksi dan keputusan giling perlu validasi QC Malang"><ShieldCheck size={15} />Referensi - validasi QC</span>} />
      <div className="qualityLegend"><strong>Standar mutu tebu</strong><span><i className="free" />Lolos giling</span><span><i className="deduction" />Rafaksi</span><span><i className="manual" />Keputusan QC</span><span><i className="reject" />Ditolak</span></div>
      <div ref={size.ref} className="qualityCards" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
        {KEBONAGUNG_GRADES.map(item => (
          <article key={item.code} className="qualityCard" style={{ borderTopColor: item.color }}>
            <button className="qualityDetailTrigger" aria-label={`Lihat detail ${item.label}`} onClick={() => setSelected(item)}><span className="qualityOpenIcon"><Maximize2 size={12} /></span></button>
            <div className="qualityPhoto">
              <img src={item.img} alt={`Contoh Visual ${item.label} (${item.name})`} />
              <span className="qualityGradeBadge" style={{ background: item.grad }}>{item.label}</span>
              <span className="qualityPhotoCaption">Contoh material tebu</span>
            </div>
            <div className="qualityBody">
              <div className="qualityCardTitle"><h2>{item.label}</h2><span style={{ color: item.color }}>{item.status}</span></div>
              <p className="qualityName">{item.name}</p>
              <div className="qualityMetrics">
                <div><span>Rafaksi</span><strong style={{ color: item.color }}>{item.rafaksi}</strong></div>
              </div>
              <p className="qualityCriteria">{item.kriteria}</p>
              <div className="qualityDecision" style={{ color: item.color, background: `${item.color}12` }}><ShieldCheck size={14} /><span>{item.decision}</span></div>
            </div>
          </article>
        ))}
      </div>
      <footer className="workspaceFooter qualityFooter">
        <span>11 kelas Malang, berurutan sesuai indeks model 0?10. Rafaksi ditentukan QC.</span>
        <span className="qualityDetailHint">Pilih kelas untuk melihat detail.</span>
      </footer>
      {selected && <div className="workspaceOverlay" onKeyDown={event => { if (event.key === "Escape") setSelected(null); }}><div className="workspaceDialog qualityDetailDialog" role="dialog" aria-modal="true" aria-labelledby="quality-detail-title">
        <div className="workspaceDialogHead"><div><h2 id="quality-detail-title">{selected.label} · {selected.name}</h2><p>{selected.status}</p></div><button autoFocus className="workspaceIcon" aria-label="Tutup detail kelas" onClick={() => setSelected(null)}><X size={18} /></button></div>
        <img className="qualityDetailPhoto" src={selected.img} alt={`Contoh visual ${selected.label}`} />
        <div className="qualityMetrics"><div><span>Rafaksi</span><strong style={{ color: selected.color }}>{selected.rafaksi}</strong></div></div>
        <p className="qualityCriteria">{selected.kriteria}</p><div className="qualityDecision" style={{ color: selected.color, background: `${selected.color}12` }}><ShieldCheck size={15} /><span>{selected.decision}</span></div>
      </div></div>}
    </section>
  );
}
