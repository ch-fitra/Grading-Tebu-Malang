import { ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { usePanelSize } from "../hooks/usePanelSize";
import { TRANGKIL_GRADES } from "../utils/grade-guide";

export function QualityGuidePage() {
  const size = usePanelSize<HTMLElement>();
  const [page, setPage] = useState(0);
  const pageSize = size.width < 600 ? (size.height < 640 ? 1 : 2) : size.height < 480 ? 2 : size.width < 1000 ? (size.height < 640 ? 2 : 4) : size.height < 720 ? 4 : 8;
  const columns = pageSize === 8 ? 4 : pageSize === 4 ? (size.width >= 1000 && size.height < 720 ? 4 : 2) : pageSize === 2 && size.width >= 600 ? 2 : 1;
  const pages = Math.ceil(TRANGKIL_GRADES.length / pageSize);
  const current = Math.min(page, pages - 1);
  const grades = TRANGKIL_GRADES.slice(current * pageSize, (current + 1) * pageSize);
  return (
    <section ref={size.ref} className="qualityGuidePage" data-count={pageSize}>
      <header className="qualityGuideHeader">
        <div>
          <span className="qualityGuideEyebrow">REFERENSI MUTU TEBU</span>
          <h1>Standar Toleransi Mutu & Panduan Kelas Label AI</h1>
          <p>Kenali setiap kelas MBS, batas toleransi, dan keputusan pabrik.</p>
        </div>
        <span className="qualityGuideClassCount">8 kelas MBS</span>
      </header>
      <div className="qualityGuideContent">
      <div className="qualityGuideGrid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.ceil(pageSize / columns)}, minmax(0, 1fr))` }}>
        {grades.map(item => (
          <article key={item.code} className="qualityGuideCard" style={{ borderTopColor: item.color }}>
            <div className="qualityGuidePhoto">
              <img src={item.img} alt={`Contoh Visual ${item.label} (${item.name})`} />
              <span className={`mbsGradeBadge ${item.badgeCls}`}>{item.label}</span>
              <span className="qualityGuidePhotoCaption">Contoh material tebu</span>
            </div>
            <div className="qualityGuideBody">
              <div className="qualityGuideCardTitle"><h2>{item.label}</h2><span style={{ color: item.color }}>{item.status}</span></div>
              <p className="qualityGuideDescription">{item.name}</p>
              <div className="qualityGuideMetrics">
                <div><span>Toleransi kotoran</span><strong>{item.tol}</strong></div>
                <div><span>Rafaksi</span><strong style={{ color: item.color }}>{item.rafaksi}</strong></div>
              </div>
              <dl className="qualityGuideCriteria">
                {item.variasi.map(line => <div key={line.label}><dt>{line.label}</dt><dd>{line.value}</dd></div>)}
              </dl>
              <div className="qualityGuideDecision" style={{ color: item.color, background: `${item.color}12` }}><ShieldCheck size={14} /><span>{item.decision}</span></div>
            </div>
          </article>
        ))}
      </div>
      <footer className="qualityGuideFooter">
        <span>Kelas T: keputusan giling dan rafaksi menunggu peninjauan QC secara manual.</span>
        <div className="qualityGuidePagination">
          <button aria-label="Kelas sebelumnya" disabled={current === 0} onClick={() => setPage(current - 1)}><ChevronLeft size={16} /></button>
          <span>{current + 1} / {pages}</span>
          <button aria-label="Kelas berikutnya" disabled={current === pages - 1} onClick={() => setPage(current + 1)}><ChevronRight size={16} /></button>
        </div>
      </footer>
      </div>
    </section>
  );
}
