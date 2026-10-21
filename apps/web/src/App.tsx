import { Gauge, History, LogOut, Users, Crown, Activity, Shield, BookOpen, PanelLeftOpen, PanelLeftClose } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "./store";
import { LoginPage } from "./components/LoginPage";
import { DashboardPage } from "./components/DashboardPage";
import { QualityGuidePage } from "./components/QualityGuidePage";
import { HistoryPage } from "./components/HistoryPage";
import { PoweredByWatermark } from "./components/shared/PoweredByWatermark";
import { AccessManagement } from "./components/AccessManagement";
const trangkilLogoSvg = "./logo-pg-trangkil.svg";

const configuredWebsocket = import.meta.env.VITE_WS_URL;
const websocketUrl = window.sugarcaneDesktop?.websocketUrl ?? (configuredWebsocket && configuredWebsocket !== "same-origin" ? configuredWebsocket : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`);

const tabs = [
  { id: "dashboard", label: "Dashboard", icon: Gauge },
  { id: "history", label: "History", icon: History },
  { id: "guide", label: "Panduan Mutu", icon: BookOpen },
  { id: "access", label: "Users & Roles", icon: Users }
] as const;

type TabId = (typeof tabs)[number]["id"];

export default function App() {
  const [tab, setTab] = useState<TabId>("dashboard");
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const { session, refresh, logout, validateSession } = useAppStore();
  const permissions = session?.user.permissions ?? [];

  useEffect(() => { setSidebarExpanded(false); }, [session?.token]);

  useEffect(() => {
    if (!sidebarExpanded) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !sidebarRef.current?.contains(event.target)) setSidebarExpanded(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSidebarExpanded(false);
      sidebarToggleRef.current?.focus();
    };
    const closeOnWindowBlur = () => setSidebarExpanded(false);
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", closeOnWindowBlur);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("blur", closeOnWindowBlur);
    };
  }, [sidebarExpanded]);

  useEffect(() => { if (session) validateSession(); }, [session?.token, validateSession]);

  useEffect(() => {
    if (!session) return;
    const required: Record<TabId, string> = { dashboard: "dashboard.read", history: "history.read", guide: "dashboard.read", access: "user.read" };
    if (!permissions.includes(required[tab])) {
      const first = tabs.find(item => permissions.includes(required[item.id]));
      if (first) setTab(first.id);
    }
  }, [permissions, session, tab]);

  useEffect(() => {
    if (!session) return;
    refresh();
    const timer = window.setInterval(refresh, 5000);
    const ws = new WebSocket(`${websocketUrl}?token=${encodeURIComponent(session.token)}`);
    ws.onmessage = () => refresh();
    return () => {
      window.clearInterval(timer);
      ws.close();
    };
  }, [refresh, session?.token]);

  if (!session) {
    return (
      <>
        <LoginPage />
        <PoweredByWatermark />
      </>
    );
  }

  const userFactory = (() => {
    const u = (session?.user.username || "").toLowerCase();
    if (u.includes("kebonagung") || u.includes("malang")) return "kebonagung";
    if (u.includes("trangkil")) return "trangkil";
    return null;
  })();

  const factoryBrand = userFactory === "kebonagung"
    ? { title: "PG Kebon Agung", subtitle: "Malang, Jawa Timur" }
    : userFactory === "trangkil"
    ? { title: "PG Trangkil", subtitle: "Pati, Jawa Tengah" }
    : { title: "Tebu AI", subtitle: "Industrial Grading" };

  return (
    <div className={`shell ${sidebarExpanded ? "sidebar-expanded" : "sidebar-collapsed"}`}>
      <aside 
        className="sidebar"
        ref={sidebarRef}
        aria-label="Menu utama"
        onPointerLeave={(event) => {
          if (event.pointerType !== "touch") setSidebarExpanded(false);
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setSidebarExpanded(false);
          }
        }}
      >
        <div className="brand">
          <div className="brandMark" title={`${factoryBrand.title} — ${factoryBrand.subtitle}`}>
            <img src={trangkilLogoSvg} alt={factoryBrand.title} className="brandLogoImg" />
          </div>
          <div className="brandText">
            <div className="brandTitleRow">
              <strong>{factoryBrand.title}</strong>
              <span className="sidebarCaneBadge">TEBU AI</span>
            </div>
            <span className="brandSubtitle">{factoryBrand.subtitle}</span>
            <span className="brandStatusTag">
              <span className="statusDotLive"></span> Online • MBS Active
            </span>
          </div>
        </div>

        <button type="button" className="sidebarToggle" ref={sidebarToggleRef}
          aria-expanded={sidebarExpanded} aria-controls="sidebar-navigation"
          aria-label={sidebarExpanded ? "Tutup menu" : "Buka menu"}
          title={sidebarExpanded ? "Tutup menu" : "Buka menu"}
          onClick={() => setSidebarExpanded(value => !value)}>
          {sidebarExpanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          <span className="sidebarToggleLabel">Tutup menu</span>
        </button>

        <div className="sidebarMenuLabel">SISTEM KENDALI MUTU</div>

        <nav className="sidebarNav" id="sidebar-navigation" aria-label="Navigasi halaman">
          {tabs.filter(item => {
            const required: Record<TabId, string> = { dashboard: "dashboard.read", history: "history.read", guide: "dashboard.read", access: "user.read" };
            return permissions.includes(required[item.id]);
          }).map((item) => {
            const Icon = item.icon;
            const isActive = tab === item.id;
            return (
              <button 
                key={item.id} 
                className={`sidebarNavBtn ${isActive ? "active" : ""}`} 
                onClick={() => { setTab(item.id); setSidebarExpanded(false); }}
                data-tooltip={item.label} 
                title={item.label}
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
              >
                <span className="navIconBox">
                  <Icon size={20} />
                </span>
                <span className="navLabel">{item.label}</span>
                {isActive && <span className="navActiveGlowPill" />}
              </button>
            );
          })}
        </nav>

        {/* User Identity Card in Sidebar (Diposisikan di atas tombol Logout menggantikan STANDAR GILING MBS) */}
        <div 
          className="sidebarUserCard" 
          title={`Login sebagai ${session.user.username} (${session.user.role})`}
          data-tooltip={`${session.user.username} (${session.user.role === "admin" ? "Direksi" : session.user.role === "operator" ? "Operator" : "Dev"})`}
        >
          <div className={`sidebarUserAvatar ${session.user.role === "admin" ? "admin" : session.user.role === "operator" ? "operator" : "dev"}`}>
            {session.user.role === "admin" ? <Crown size={16} /> : session.user.role === "operator" ? <Activity size={16} /> : <Shield size={16} />}
          </div>
          <div className="sidebarUserMeta">
            <div className="sidebarUserNameRow">
              <strong>{session.user.username}</strong>
              <span className="sidebarLivePulseDot" title="Sesi Terhubung Aktif" />
            </div>
            <span className={`sidebarUserRoleTag ${session.user.role === "admin" ? "admin" : session.user.role === "operator" ? "operator" : "dev"}`}>
              {session.user.role === "admin" ? "👑 Direksi (Admin)" : session.user.role === "operator" ? "⚙️ Operator Meja" : "🛠️ Developer"}
            </span>
          </div>
        </div>

        <div className="sidebarFooter">
          <button 
            className="sidebarLogout" 
            onClick={logout} 
            data-tooltip="Logout" 
            aria-label="Logout"
          >
            <span className="navIconBox">
              <LogOut size={19} />
            </span>
            <span className="navLabel">Logout</span>
          </button>
          <div className="sidebarWatermarkWrap">
            <PoweredByWatermark />
          </div>
        </div>
      </aside>
      <main className={(tab === "dashboard" || tab === "guide" || tab === "history") ? "dashboardMainFixed" : ""}>
        {tab === "dashboard" && permissions.includes("dashboard.read") && <DashboardPage />}
        {tab === "guide" && permissions.includes("dashboard.read") && <QualityGuidePage />}
        {tab === "history" && permissions.includes("history.read") && <HistoryPage />}
        {tab === "access" && permissions.includes("user.read") && <AccessManagement />}
      </main>
    </div>
  );
}
