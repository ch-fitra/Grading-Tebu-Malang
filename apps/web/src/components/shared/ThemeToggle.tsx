import { Check, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemePreference() {
  const [theme, setTheme] = useState(() => {
    const stored = localStorage.getItem("tebu-ui-theme");
    return stored === "dark" ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("tebu-ui-theme", theme);
  }, [theme]);

  useEffect(() => {
    const syncTheme = () => {
      const stored = localStorage.getItem("tebu-ui-theme");
      setTheme(stored === "dark" ? "dark" : "light");
    };
    window.addEventListener("storage", syncTheme);
    window.addEventListener("focus", syncTheme);
    return () => {
      window.removeEventListener("storage", syncTheme);
      window.removeEventListener("focus", syncTheme);
    };
  }, []);

  return (
    <section className="themePreference" aria-labelledby="theme-preference-title">
      <div className="themePreferenceHeader">
        <div>
          <span className="settingsEyebrow">Appearance</span>
          <h3 id="theme-preference-title">Tampilan Aplikasi</h3>
          <p>Pilih tema yang nyaman untuk lingkungan kerja Anda. Pilihan disimpan pada perangkat ini.</p>
        </div>
      </div>
      <div className="themeOptions" role="radiogroup" aria-label="Pilihan tema">
        <button type="button" role="radio" aria-checked={theme === "light"} className={`themeOption ${theme === "light" ? "selected" : ""}`} onClick={() => setTheme("light")}>
          <span className="themePreview lightPreview"><span /><span /><span /></span>
          <span className="themeOptionText"><Sun size={17} /><strong>Mode Terang</strong><small>Jernih dan nyaman untuk siang hari</small></span>
          {theme === "light" && <Check className="themeSelectedCheck" size={18} />}
        </button>
        <button type="button" role="radio" aria-checked={theme === "dark"} className={`themeOption ${theme === "dark" ? "selected" : ""}`} onClick={() => setTheme("dark")}>
          <span className="themePreview darkPreview"><span /><span /><span /></span>
          <span className="themeOptionText"><Moon size={17} /><strong>Mode Gelap</strong><small>Redup untuk ruang kontrol dan malam hari</small></span>
          {theme === "dark" && <Check className="themeSelectedCheck" size={18} />}
        </button>
      </div>
    </section>
  );
}
