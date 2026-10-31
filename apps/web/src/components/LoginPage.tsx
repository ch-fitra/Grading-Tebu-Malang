import { Eye, EyeOff, LogIn, Shield, Cpu, Gauge, Monitor } from "lucide-react";
import { useState } from "react";
import { useAppStore } from "../store";

export function LoginPage() {
  const { login } = useAppStore();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(username, password);
    } catch (error) {
      setError(error instanceof TypeError ? "Tidak dapat terhubung ke server API. Periksa koneksi dan alamat server desktop." : error instanceof Error ? error.message : "Login gagal. Silakan coba kembali.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="loginPageLayout">
      {/* Brand Context Screen Left */}
      <div className="loginLeftPanel">
        <div className="loginLogoSection">
          <img className="loginMainLogo" src={`${import.meta.env.BASE_URL}vale-amaze-mekaar-logo.png`} alt="Vale Amaze Mekaar" />
          <span className="loginStatusBadge">PG Kebon Agung - Malang</span>
        </div>
        
        <div className="loginBrandMessage">
          <h2>AI Sugar Cane Grading System</h2>
          <p>
            Pemantauan mutu tebu PG Kebon Agung, Malang, Jawa Timur
          </p>
        </div>
        
        {/* Feature chips */}
        <div className="featureChipsGroup">
          <div className="featureChip">
            <Cpu size={16} />
            <span>Computer Vision</span>
          </div>
          <div className="featureChip">
            <Monitor size={16} />
            <span>Offline Dashboard</span>
          </div>
          <div className="featureChip">
            <Gauge size={16} />
            <span>Real-time Grading</span>
          </div>
        </div>

        <div className="loginFooterInfo">
          <Shield size={14} />
          <span>Secure local operator console</span>
        </div>
      </div>

      {/* Login Form Screen Right */}
      <div className="loginRightPanel">
        <form className="loginPanel" onSubmit={submit}>
          <div className="loginHeading mobileOnly">
            <img className="loginLogoMobile" src={`${import.meta.env.BASE_URL}vale-amaze-mekaar-logo.png`} alt="Vale Amaze Mekaar" />
            <h2>AI Sugar Cane Grading</h2>
            <span className="loginStatusBadge">PG Kebon Agung - Malang</span>
          </div>

          <div className="loginFormInputs">
            <label>
              Username
              <input value={username} onChange={(event) => setUsername(event.target.value)} autoFocus placeholder="Enter administrator username" />
            </label>
            <label>
              Password
              <span className="passwordField">
                <input type={passwordVisible ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter security credentials" />
                <button type="button" className="passwordVisibilityButton" onClick={() => setPasswordVisible((visible) => !visible)} aria-label={passwordVisible ? "Sembunyikan password" : "Lihat password"} title={passwordVisible ? "Sembunyikan password" : "Lihat password"}>
                  {passwordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
          </div>

          {error && <div className="loginError">{error}</div>}

          <button className="primary loginButton" disabled={busy}>
            <LogIn size={17} />
            {busy ? "Signing in to Console..." : "Sign In to Console"}
          </button>
        </form>
      </div>
    </div>
  );
}
