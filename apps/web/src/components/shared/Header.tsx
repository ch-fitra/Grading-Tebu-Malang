import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useAppStore } from "../../store";
import { Clock, ShieldCheck, ShieldAlert } from "lucide-react";

export function Header({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  const { status } = useAppStore();
  const [time, setTime] = useState("");

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString("id-ID", { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  const backendOk = status?.backend.status === "ok";

  return (
    <header className="pageHeader">
      <div className="headerBrandGroup">
        <div className="headerTitles">
          <h1>{title}</h1>
          {subtitle && <span className="headerSubtitle">{subtitle}</span>}
        </div>
      </div>
      
      <div className="headerUtilityGroup">
        {/* System Health Status Badge */}
        <div className={`systemHealthBadge ${backendOk ? "online" : "offline"}`}>
          {backendOk ? (
            <>
              <ShieldCheck size={14} />
              <span>Console Online</span>
            </>
          ) : (
            <>
              <ShieldAlert size={14} />
              <span>Console Connecting</span>
            </>
          )}
        </div>

        {/* Local Clock */}
        <div className="headerClock">
          <Clock size={13} />
          <span>{time}</span>
        </div>

        {/* Custom Actions */}
        {action && <div className="headerCustomActions">{action}</div>}

      </div>
    </header>
  );
}
