import { Gauge, History, LogOut, Users, Crown, Activity, Shield } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppStore } from "./store";
import { LoginPage } from "./components/LoginPage";
import { DashboardPage } from "./components/DashboardPage";
import { HistoryPage } from "./components/HistoryPage";
import { PoweredByWatermark } from "./components/shared/PoweredByWatermark";
import { AccessManagement } from "./components/AccessManagement";
const trangkilLogoSvg = "./logo-pg-trangkil.svg";

const websocketUrl = window.sugarcaneDesktop?.websocketUrl ?? import.meta.env.VITE_WS_URL ?? "ws://127.0.0.1:4110/ws";

const tabs = [
  { id: "dashboard", label: "Dashboard", icon: Gauge },
  { id: "history", label: "History", icon: History },
  { id: "access", label: "Users & Roles", icon: Users }
] as const;

type TabId = (typeof tabs)[number]["id"];

export default function App() {
  const [tab, setTab] = useState<TabId>("dashboard");
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const { session, refresh, logout, validateSession } = useAppStore();
  const permissions = session?.user.permissions ?? [];

  useEffect(() => { if (session) validateSession(); }, [session?.token, validateSession]);

  useEffect(() => {
    if (!session) return;
    const required: Record<TabId, string> = { dashboard: "dashboard.read", history: "history.read", access: "user.read" };
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
        onMouseEnter={() => setSidebarExpanded(true)}
        onMouseLeave={() => setSidebarExpanded(false)}
        onFocus={() => setSidebarExpanded(true)}
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

        <div className="sidebarMenuLabel">SISTEM KENDALI MUTU</div>

        <nav className="sidebarNav">
          {tabs.filter(item => {
            const required: Record<TabId, string> = { dashboard: "dashboard.read", history: "history.read", access: "user.read" };
            return permissions.includes(required[item.id]);
          }).map((item) => {
            const Icon = item.icon;
            const isActive = tab === item.id;
            return (
              <button 
                key={item.id} 
                className={`sidebarNavBtn ${isActive ? "active" : ""}`} 
                onClick={() => setTab(item.id)} 
                data-tooltip={item.label} 
                aria-label={item.label}
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
      <main className={tab === "dashboard" ? "dashboardMainFixed" : ""}>
        {tab === "dashboard" && permissions.includes("dashboard.read") && <DashboardPage />}
        {tab === "history" && permissions.includes("history.read") && <HistoryPage />}
        {tab === "access" && permissions.includes("user.read") && <AccessManagement />}
      </main>
    </div>
  );
}
