import { Camera, Cpu, Gauge, History, LogOut, Settings, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppStore } from "./store";
import { LoginPage } from "./components/LoginPage";
import { DashboardPage } from "./components/DashboardPage";
import { HistoryPage } from "./components/HistoryPage";
import { CameraManager } from "./components/CameraManager";
import { ModelManager } from "./components/ModelManager";
import { SettingsPage } from "./components/SettingsPage";
import { PoweredByWatermark } from "./components/shared/PoweredByWatermark";
import { AccessManagement } from "./components/AccessManagement";

const websocketUrl = window.sugarcaneDesktop?.websocketUrl ?? import.meta.env.VITE_WS_URL ?? "ws://127.0.0.1:4110/ws";

const tabs = [
  { id: "dashboard", label: "Dashboard", icon: Gauge },
  { id: "history", label: "History", icon: History },
  { id: "cameras", label: "Cameras", icon: Camera },
  { id: "models", label: "Models", icon: Cpu },
  { id: "settings", label: "Settings", icon: Settings },
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
    const required: Record<TabId, string> = { dashboard: "dashboard.read", history: "history.read", cameras: "camera.read", models: "model.read", settings: "settings.read", access: "user.read" };
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
          <div className="brandMark">VAM</div>
          <div className="brandText">
            <div className="brandTitleRow">
              <strong>Tebu AI</strong>
              <span className="sidebarLocalBadge">Local AI</span>
            </div>
            <span>Industrial Grading</span>
          </div>
        </div>
        <div className="sidebarMenuLabel">MAIN MENU</div>
        <nav>
          {tabs.filter(item => item.id !== "access" || permissions.includes("user.read")).filter(item => {
            const required: Record<string, string> = { dashboard: "dashboard.read", history: "history.read", cameras: "camera.read", models: "model.read", settings: "settings.read" };
            return item.id === "access" || permissions.includes(required[item.id]);
          }).map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)} title={item.label} aria-label={item.label}>
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <button className="sidebarLogout" onClick={logout} title="Logout" aria-label="Logout">
          <LogOut size={18} />
          <span>Logout</span>
        </button>
        <PoweredByWatermark />
      </aside>
      <main>
        {tab === "dashboard" && <DashboardPage />}
        {tab === "history" && <HistoryPage />}
        {tab === "cameras" && <CameraManager />}
        {tab === "models" && <ModelManager />}
        {tab === "settings" && <SettingsPage />}
        {tab === "access" && <AccessManagement />}
      </main>
    </div>
  );
}
