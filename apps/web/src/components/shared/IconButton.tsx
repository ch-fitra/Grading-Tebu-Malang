import type { LucideIcon } from "lucide-react";

export function IconButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick?: () => void }) {
  return (
    <button className="iconButton" title={label} onClick={onClick}>
      <Icon size={18} />
      <span>{label}</span>
    </button>
  );
}