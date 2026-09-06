import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Truck, ShieldCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useT } from "../lib/i18n";
import { errMsg } from "../lib/api";
import { LangToggle } from "../components/AppLayout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

const HERO = "https://images.unsplash.com/photo-1622645636770-11fbf0611463?crop=entropy&cs=srgb&fm=jpg&q=85&w=1600";

export default function LoginPage() {
  const { login } = useAuth();
  const { t } = useT();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      toast.error(errMsg(err, t("login_failed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden lg:block">
        <img src={HERO} alt="Dump truck at mining site" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-brand-dark/90 via-brand-dark/40 to-brand/30" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <img src="/logo-dark.png" alt="Inline Technology" className="w-44 rounded-md" />
          <div className="max-w-md">
            <p className="font-heading text-xs font-semibold uppercase tracking-[0.3em] text-brand-light">{t("app_name")}</p>
            <h1 className="mt-3 font-heading text-4xl font-semibold leading-tight tracking-tight lg:text-5xl">{t("tagline")}</h1>
            <div className="mt-8 flex gap-6 text-sm text-white/80">
              <span className="flex items-center gap-2"><Truck className="h-4 w-4" /> 37-point chassis check</span>
              <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Admin approval</span>
            </div>
          </div>
        </div>
      </div>

      <div className="dot-grid flex min-h-screen flex-col justify-center px-6 py-10 sm:px-12 lg:px-20">
        <div className="mb-8 flex items-center justify-between">
          <img src="/logo.png" alt="Inline Technology" className="h-12" />
          <LangToggle />
        </div>
        <div className="fade-up w-full max-w-md">
          <p className="font-heading text-xs font-semibold uppercase tracking-[0.25em] text-brand-deep">{t("app_name")}</p>
          <h2 className="mt-2 font-heading text-3xl font-semibold tracking-tight">{t("login_title")}</h2>
          <form onSubmit={submit} className="mt-8 space-y-5" data-testid="login-form">
            <div className="space-y-1.5">
              <Label htmlFor="email">{t("email")}</Label>
              <Input id="email" data-testid="login-email-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 bg-white" placeholder="name@company.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t("password")}</Label>
              <Input id="password" data-testid="login-password-input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 bg-white" placeholder="••••••••" />
            </div>
            <Button type="submit" disabled={busy} data-testid="login-submit-btn" className="h-11 w-full rounded-full text-base">
              {busy ? t("signing_in") : t("sign_in")}
            </Button>
          </form>
          <div className="mt-8 rounded-2xl border bg-white/70 p-4 text-xs text-muted-foreground backdrop-blur" data-testid="demo-accounts">
            <p className="mb-2 font-semibold uppercase tracking-wider">{t("login_hint")}</p>
            <div className="grid gap-1 font-mono">
              <button type="button" className="text-left hover:text-brand-dark" onClick={() => { setEmail("admin@iti.demo"); setPassword("Admin@1234"); }} data-testid="demo-admin-btn">admin@iti.demo / Admin@1234</button>
              <button type="button" className="text-left hover:text-brand-dark" onClick={() => { setEmail("driver@iti.demo"); setPassword("Driver@1234"); }} data-testid="demo-driver-btn">driver@iti.demo / Driver@1234</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
