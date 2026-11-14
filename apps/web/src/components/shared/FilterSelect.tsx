import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Lock } from "lucide-react";

export type FilterOption = { value: string; label: string; disabled?: boolean };
type Props = { label: string; value: string; options: FilterOption[]; onChange: (value: string) => void };

export function FilterSelect({ label, value, options, onChange }: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const search = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 320, above: false });
  const selected = options.find(option => option.value === value);
  const enabled = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);

  function close(restoreFocus = false) {
    setOpen(false);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setRendered(false), 150);
    if (restoreFocus) trigger.current?.focus();
  }
  function show(last = false) {
    clearTimeout(closeTimer.current);
    const current = options.findIndex(option => option.value === value && !option.disabled);
    setActive(current >= 0 ? current : last ? enabled.at(-1) ?? -1 : enabled[0] ?? -1);
    search.current = { text: "", at: 0 };
    setRendered(true);
    setOpen(true);
  }
  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    close(true);
  }
  function navigate(event: KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === "Tab") { close(); trigger.current?.focus(); }
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(active); }
    else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const current = enabled.indexOf(active);
      setActive(event.key === "Home" ? enabled[0] ?? -1 : event.key === "End" ? enabled.at(-1) ?? -1 : enabled[(current + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length] ?? -1);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      search.current = { text: (now - search.current.at < 600 ? search.current.text : "") + event.key.toLocaleLowerCase(), at: now };
      const match = enabled.find(index => options[index].label.toLocaleLowerCase().startsWith(search.current.text));
      if (match !== undefined) setActive(match);
    }
  }
  useLayoutEffect(() => {
    if (!rendered) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const flipped = below < 260 && above > below;
      const maxHeight = Math.max(60, Math.min(320, flipped ? above : below));
      const height = Math.min(options.length * 44 + 12, maxHeight);
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)), top: flipped ? Math.max(8, rect.top - height - 8) : rect.bottom + 8, width: Math.min(rect.width, window.innerWidth - 16), maxHeight, above: flipped });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [rendered, options.length]);
  useEffect(() => {
    if (!open) return;
    menu.current?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) close();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => { if (open && active >= 0) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" }); }, [active, open, id]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  return <>
    <button ref={trigger} type="button" role="combobox" aria-label={label} aria-expanded={open} aria-haspopup="listbox" aria-controls={rendered ? id : undefined}
      className="filterSelectTrigger" data-open={open} onClick={() => open ? close(true) : show()}
      onKeyDown={event => { if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); show(event.key === "ArrowUp" || event.key === "End"); if (event.key === "Home") setActive(enabled[0] ?? -1); if (event.key === "End") setActive(enabled.at(-1) ?? -1); } }}>
      <span>{selected?.label ?? "Pilih opsi"}</span><ChevronDown size={15} aria-hidden="true" />
    </button>
    {rendered && createPortal(<div ref={menu} id={id} role="listbox" aria-label={label} aria-hidden={!open} tabIndex={-1}
      aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined} className="filterSelectMenu" data-open={open} data-above={position.above}
      style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }} onKeyDown={navigate}>
      {options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined}
        className="filterSelectOption" data-active={active === index} onPointerMove={() => { if (!option.disabled) setActive(index); }} onClick={() => choose(index)}>
        <span className="filterSelectOptionLabel">{option.label}</span>
        {option.disabled ? <span className="filterSelectUnavailable"><Lock size={11} />Tidak tersedia</span> : option.value === value ? <Check size={15} className="filterSelectCheck" aria-hidden="true" /> : <span className="filterSelectOptionSpacer" />}
      </div>)}
    </div>, document.body)}
  </>;
}
