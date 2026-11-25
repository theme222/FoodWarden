import type { AuthConfig } from "../auth";
import type { Language } from "../model";
import { words } from "../words";

export function SignInPanel({
  config,
  language,
  signingIn,
  onGoogle,
  onDev,
  embedded = false,
}: {
  config: AuthConfig | null;
  language: Language;
  signingIn: boolean;
  onGoogle: () => Promise<void>;
  onDev: () => Promise<void>;
  embedded?: boolean;
}) {
  const th = language === "th";
  const t = words[language];
  const HeroHeading = embedded ? "h3" : "h1";
  const SignInHeading = embedded ? "h3" : "h2";
  if (!config?.googleEnabled && !config?.devLoginEnabled) {
    return <p className="panel">{t.setup}</p>;
  }

  const bullets = th
    ? [
        "รู้ทันทีว่าอาหารชิ้นไหนใกล้หมดอายุ (FEFO)",
        "ติดตามอุณหภูมิ กลิ่น และการปิดประตูแบบเรียลไทม์",
        "แจ้งเตือนผ่าน LINE ทั้งกลุ่มครอบครัวและส่วนตัว",
        "ใช้งานง่ายทั้งมือถือและคอมพิวเตอร์",
      ]
    : [
        "Spot expiring food at a glance with FEFO priority",
        "Live fridge temperature, VOC air quality, and door safety",
        "Instant family and personal LINE notifications",
        "Built for every family member on phone or desktop",
      ];

  const heroTitle = th
    ? "รู้ทันของในตู้เย็น ก่อนหมดอายุ"
    : "Know what’s fresh before it spoils";

  return (
    <div className="login">
      <section className="login-hero">
        <HeroHeading className="login-title">{heroTitle}</HeroHeading>
        <p className="login-lead">{t.welcome}</p>
        <ul className="login-bullets">
          {bullets.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section className="signin-card">
        <SignInHeading className="signin-title">
          {th ? "เข้าสู่ระบบเพื่อเริ่มต้น" : "Sign in to your fridge"}
        </SignInHeading>
        {config?.googleEnabled && (
          <button
            className="gbtn"
            type="button"
            onClick={() => void onGoogle()}
            disabled={signingIn}
          >
            {signingIn ? t.loading : t.signIn}
          </button>
        )}
        {config?.devLoginEnabled && (
          <button
            className={config?.googleEnabled ? "gbtn alt" : "gbtn"}
            type="button"
            onClick={() => void onDev()}
            disabled={signingIn}
          >
            {signingIn ? t.loading : t.devSignIn}
          </button>
        )}
        {config.googleEnabled && (
          <p className="signin-note">
            {th
              ? "ใช้บัญชี Google ของคุณเพื่อเข้าถึงตู้เย็นที่แชร์ร่วมกันในบ้าน"
              : "Use your Google account to view fridges shared with your household."}
          </p>
        )}
      </section>
    </div>
  );
}
