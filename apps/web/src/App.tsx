import { Gauge, History, LogOut, Users, Crown, Activity, Shield, BookOpen, Camera } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "./store";
import { LoginPage } from "./components/LoginPage";
import { DashboardPage } from "./components/DashboardPage";
import { QualityGuidePage } from "./components/QualityGuidePage";
import { HistoryPage } from "./components/HistoryPage";
import { PoweredByWatermark } from "./components/shared/PoweredByWatermark";
import { CameraConfigurationPage } from "./components/CameraConfigurationPage";
import { AccessManagement } from "./components/AccessManagement";
const kebonagungLogoSvg = "./logo-pg-kebonagung.svg";

const configuredWebsocket = import.meta.env.VITE_WS_URL;
const websocketUrl = window.sugarcaneDesktop?.websocketUrl ?? (configuredWebsocket && configuredWebsocket !== "same-origin" ? configuredWebsocket : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`);

const tabs = [
  { id: "dashboard", label: "Dashboard", icon: Gauge },
  { id: "history", label: "History", icon: History },
  { id: "guide", label: "Panduan Mutu", icon: BookOpen },
  { id: "cameras", label: "Konfigurasi Kamera", icon: Camera },
  { id: "access", label: "Users & Roles", icon: Users }
] as const;

type TabId = (typeof tabs)[number]["id"];

export default function App() {
  const [tab, setTab] = useState<TabId>("dashboard");
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarSuppressedRef = useRef(false);
  const { session, status, refresh, logout, validateSession } = useAppStore();
  const permissions = session?.user.permissions ?? [];

  const closeSidebar = useCallback(() => {
    setSidebarExpanded(false);
  }, []);

  const openSidebarFromPointer = (clientX: number) => {
    if (sidebarExpanded || sidebarSuppressedRef.current || window.innerWidth <= 1200) return;
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const collapsedWidth = parseFloat(getComputedStyle(sidebar).getPropertyValue("--sidebar-collapsed-width")) || 68;
    // Only the actual collapsed strip can activate the menu, including while it is shrinking.
    if (clientX < sidebar.getBoundingClientRect().left + collapsedWidth) setSidebarExpanded(true);
  };

  useEffect(() => { closeSidebar(); }, [session?.token, closeSidebar]);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !sidebarRef.current?.contains(event.target)) closeSidebar();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      sidebarSuppressedRef.current = true;
      closeSidebar();
    };
    const closeOnWindowBlur = () => closeSidebar();
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", closeOnWindowBlur);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("blur", closeOnWindowBlur);
    };
  }, [closeSidebar]);

  useEffect(() => { if (session) validateSession(); }, [session?.token, validateSession]);

  useEffect(() => {
    if (!session) return;
    const required: Record<TabId, string> = { dashboard: "dashboard.read", history: "history.read", guide: "dashboard.read", cameras: "camera.read", access: "user.read" };
    if (!permissions.includes(required[tab])) {
      const first = tabs.find(item => permissions.includes(required[item.id]));
      if (first) setTab(first.id);
    }
  }, [permissions, session, tab]);

  useEffect(() => {
    if (!session) return;
    refresh();
    const timer = window.setInterval(refresh, 5000);
    let ws: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout>;
    let stopped = false;
    let attempts = 0;
    const connect = () => {
      if (stopped) return;
      try {
        const address = new URL(websocketUrl);
        address.searchParams.set("token", session.token);
        ws = new WebSocket(address);
        ws.onopen = () => { attempts = 0; void refresh(); };
        ws.onmessage = () => { void refresh(); };
        ws.onclose = event => {
          if (stopped) return;
          if (event.code === 1008) { void validateSession(); return; }
          retry = setTimeout(connect, Math.min(10000, 1000 * 2 ** Math.min(attempts++, 4)));
        };
        ws.onerror = () => ws?.close();
      } catch {
        retry = setTimeout(connect, 5000);
      }
    };
    connect();
    return () => {
      stopped = true;
      window.clearInterval(timer);
      clearTimeout(retry);
      ws?.close();
    };
  }, [refresh, session?.token, validateSession]);

  if (!session) {
    return (
      <>
        <LoginPage />
        <PoweredByWatermark />
      </>
    );
  }

  const roleLabel = session.user.role === "admin" ? "Direksi (Admin)" : session.user.role === "operator" ? "Operator Meja" : session.user.role === "developer" ? "Developer" : session.user.role;
  const factoryBrand = { title: "PG Kebon Agung", subtitle: "Malang, Jawa Timur" };

  return (
    <div className={`shell ${sidebarExpanded ? "sidebar-expanded" : "sidebar-collapsed"}`}>
      <aside 
        className="sidebar"
        ref={sidebarRef}
        aria-label="Menu utama"
        onPointerEnter={(event) => {
          if (event.pointerType === "touch") return;
          sidebarSuppressedRef.current = false;
          openSidebarFromPointer(event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.pointerType === "touch") return;
          openSidebarFromPointer(event.clientX);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "touch") return;
          sidebarSuppressedRef.current = false;
          closeSidebar();
        }}
        onFocus={(event) => {
          if (event.target.matches(":focus-visible") && window.innerWidth > 1200) {
            sidebarSuppressedRef.current = false;
            setSidebarExpanded(true);
          }
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            closeSidebar();
          }
        }}
      >
        <div className="brand">
          <div className="brandMark" title={`${factoryBrand.title} — ${factoryBrand.subtitle}`}>
            <img src={kebonagungLogoSvg} alt={factoryBrand.title} className="brandLogoImg" />
          </div>
          <div className="brandText">
            <div className="brandTitleRow">
              <strong>{factoryBrand.title}</strong>
              <span className="sidebarCaneBadge">TEBU AI</span>
            </div>
            <span className="brandSubtitle">{factoryBrand.subtitle}</span>
            <span className="brandStatusTag">
              <span className="statusDotLive"></span> {status?.backend.status === "ok" ? "Online" : "Offline"} • Tebu AI
            </span>
          </div>
        </div>

        <div className="sidebarMenuLabel">SISTEM KENDALI MUTU</div>

        <nav className="sidebarNav" id="sidebar-navigation" aria-label="Navigasi halaman">
          {tabs.filter(item => {
            const required: Record<TabId, string> = { dashboard: "dashboard.read", history: "history.read", guide: "dashboard.read", cameras: "camera.read", access: "user.read" };
            return permissions.includes(required[item.id]);
          }).map((item) => {
            const Icon = item.icon;
            const isActive = tab === item.id;
            return (
              <button 
                key={item.id} 
                className={`sidebarNavBtn ${isActive ? "active" : ""}`} 
                onClick={() => { setTab(item.id); sidebarSuppressedRef.current = true; closeSidebar(); }}
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
          data-tooltip={`${session.user.username} (${roleLabel})`}
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
              {roleLabel}
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
      <main className="dashboardMainFixed">
        {!permissions.some(permission => ["dashboard.read", "history.read", "camera.read", "user.read"].includes(permission)) && <p role="status">Akun ini belum memiliki akses halaman. Hubungi administrator untuk mengatur hak akses.</p>}
        {tab === "dashboard" && permissions.includes("dashboard.read") && <DashboardPage />}
        {tab === "guide" && permissions.includes("dashboard.read") && <QualityGuidePage />}
        {tab === "history" && permissions.includes("history.read") && <HistoryPage />}
        {tab === "cameras" && permissions.includes("camera.read") && <CameraConfigurationPage />}
        {tab === "access" && permissions.includes("user.read") && <AccessManagement />}
      </main>
    </div>
  );
}
