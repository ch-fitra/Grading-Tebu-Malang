import { useState } from "react";
import { X, Play } from "lucide-react";

interface StartTruckInspectionModalProps {
  line: number;
  onClose: () => void;
  onSubmit: (data: {
    truckCode: string;
    plateNumber?: string;
    driverName?: string;
    supplier?: string;
    line: number;
    notes?: string;
  }) => void;
}

export function StartTruckInspectionModal({ line, onClose, onSubmit }: StartTruckInspectionModalProps) {
  const [truckCode, setTruckCode] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [supplier, setSupplier] = useState("");
  const [notes, setNotes] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!truckCode.trim()) return;
    onSubmit({
      truckCode: truckCode.trim(),
      plateNumber: plateNumber.trim() || undefined,
      driverName: driverName.trim() || undefined,
      supplier: supplier.trim() || undefined,
      line,
      notes: notes.trim() || undefined
    });
  };

  return (
    <div 
      className="modal-backdrop" 
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title-start-truck"
    >
      <form 
        className="capture-detail-modal start-truck-modal" 
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="capture-detail-modal__header">
          <div>
            <h2 id="modal-title-start-truck">Start Truck Inspection</h2>
            <p>Initiate a new quality grading session for an incoming supplier truck</p>
          </div>
          <button 
            type="button" 
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close form"
            title="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="capture-detail-modal__body form-body">
          <div className="form-group-grid">
            <div className="form-field">
              <label htmlFor="truckCode">Truck Code / ID <span className="required-star">*</span></label>
              <input 
                type="text" 
                id="truckCode"
                placeholder="e.g., TRK-9832"
                value={truckCode}
                onChange={(e) => setTruckCode(e.target.value)}
                required
                autoFocus
              />
            </div>
            
            <div className="form-field">
              <label htmlFor="plateNumber">Plate Number (Nomor Polisi)</label>
              <input 
                type="text" 
                id="plateNumber"
                placeholder="e.g., AD 1234 XY"
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value)}
              />
            </div>

            <div className="form-field">
              <label htmlFor="driverName">Driver Name</label>
              <input 
                type="text" 
                id="driverName"
                placeholder="e.g., Budi Santoso"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
              />
            </div>

            <div className="form-field">
              <label htmlFor="supplier">Supplier Name / Vendor</label>
              <input 
                type="text" 
                id="supplier"
                placeholder="e.g., Koperasi Tebu Makmur"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
              />
            </div>

            <div className="form-field full-width">
              <label htmlFor="notes">Inspection Notes</label>
              <textarea 
                id="notes"
                placeholder="e.g., Freshly harvested, wet condition"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>

            <div className="form-field-info full-width">
              <span>Active Line: <strong>Line {line}</strong></span>
              <p>Detections on Line {line} will be automatically assigned to this truck.</p>
            </div>
          </div>
        </div>

        <div className="capture-detail-modal__footer">
          <button 
            type="button" 
            className="modal-footer-btn secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button 
            type="submit" 
            className="modal-footer-btn primary"
            disabled={!truckCode.trim()}
          >
            <Play size={12} style={{ marginRight: 6 }} />
            Start Session
          </button>
        </div>
      </form>
    </div>
  );
}
