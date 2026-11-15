import { LineConnection } from "./LineConnection";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "./components/ui/select";
import useSWR from "swr";
import { getJson, swrOptions, isAccessError } from "./lib/api";
import { useConfirm } from "./components/confirmation";
import { StatusAlert } from "./components/status-alert";
import { toast } from "sonner";
import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { readFridgeSettings } from "./model";
import type { FridgeSettings, Language, MemberRole } from "./model";
import { words } from "./words";

function useSettings({
  fridgeId,
  language,
  onFridgesChanged,
}: {
  fridgeId: string;
  language: Language;
  onFridgesChanged: () => void;
}) {
  const t = words[language];
  const navigate = useNavigate();
  const confirm = useConfirm();
  const baseUrl = `/api/fridges/${encodeURIComponent(fridgeId)}`;
  const state = useSWR(
    `${baseUrl}/settings`,
    (url) => getJson(url, readFridgeSettings),
    swrOptions,
  );
  const settings: FridgeSettings | null = isAccessError(state.error)
    ? null
    : (state.data ?? null);
  const loading = state.isLoading;
  const setSettings = (next: FridgeSettings) => {
    void state.mutate(next, { revalidate: false });
  };
  const loadSettings = async () => {
    await state.mutate();
  };
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [nameInput, setName] = useState<string | null>(null);
  const name = nameInput ?? settings?.name ?? "";
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState(false);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("member");

  async function saveGeneral(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !settings) return;
    setBusy(true);
    setNotice(null);
    setError(null);

    try {
      const payload: Record<string, string | null> = {
        name: name.trim(),
      };
      if (geminiKeyInput.trim()) {
        payload.gemini_api_key = geminiKeyInput.trim();
      }
      const res = await fetch(`${baseUrl}/settings`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Save failed");
      const updated = readFridgeSettings(await res.json());
      setSettings(updated);
      setName(updated.name);
      setGeminiKeyInput("");
      setNotice(t.settingsSaved);
      toast.success(t.settingsSaved);
      onFridgesChanged();
    } catch {
      setError(t.actionFailed);
      toast.error(t.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  async function clearGeminiKey() {
    if (busy || !settings) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/settings`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gemini_api_key: null }),
      });
      if (!res.ok) throw new Error("Clear key failed");
      const updated = readFridgeSettings(await res.json());
      setSettings(updated);
      setNotice(t.settingsSaved);
      toast.success(t.settingsSaved);
    } catch {
      setError(t.actionFailed);
      toast.error(t.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  async function rotateToken() {
    if (busy || !settings) return;
    if (!(await confirm(t.confirmRotateToken, t.rotateToken))) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/gateway-token/rotate`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Rotate failed");
      const data = (await res.json()) as { gateway_token: string };
      setSettings({ ...settings, gatewayToken: data.gateway_token });
      setShowToken(true);
      setNotice(t.settingsSaved);
      toast.success(t.settingsSaved);
    } catch {
      setError(t.actionFailed);
      toast.error(t.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  async function copyToken() {
    if (!settings) return;
    try {
      await navigator.clipboard.writeText(settings.gatewayToken);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setShowToken(true);
    }
  }

  async function inviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !inviteEmail.trim()) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/members`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
      });
      if (!res.ok) throw new Error("Invite failed");
      setInviteEmail("");
      await loadSettings();
      setNotice(t.settingsSaved);
      toast.success(t.settingsSaved);
    } catch {
      setError(t.actionFailed);
      toast.error(t.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(email: string) {
    if (busy) return;
    if (!(await confirm(t.confirmRemoveMember, t.removeMember))) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(
        `${baseUrl}/members/${encodeURIComponent(email)}`,
        {
          method: "DELETE",
          credentials: "same-origin",
        },
      );
      if (!res.ok) throw new Error("Remove failed");
      await loadSettings();
      setNotice(t.settingsSaved);
      toast.success(t.settingsSaved);
    } catch {
      setError(t.actionFailed);
      toast.error(t.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  async function removeFridge() {
    if (busy) return;
    if (!(await confirm(t.confirmDeleteFridge, t.deleteFridge))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(baseUrl, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Delete fridge failed");
      onFridgesChanged();
      navigate("/fridges", { replace: true });
    } catch {
      setError(t.actionFailed);
      toast.error(t.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  return {
    t,
    settings,
    loading,
    busy,
    notice,
    error,
    name,
    setName,
    geminiKeyInput,
    setGeminiKeyInput,
    showToken,
    setShowToken,
    copied,
    inviteEmail,
    setInviteEmail,
    inviteRole,
    setInviteRole,
    saveGeneral,
    clearGeminiKey,
    copyToken,
    rotateToken,
    removeMember,
    inviteMember,
    removeFridge,
  };
}

type SettingsController = ReturnType<typeof useSettings>;
type SettingsView = SettingsController & {
  settings: NonNullable<SettingsController["settings"]>;
  language: Language;
  fridgeId: string;
};
function FamilySetupGuide({ view }: { view: SettingsView }) {
  const { language } = view;
  return (
    <section className="surface setup-flow">
      <h2>
        {language === "th"
          ? "เตรียมตู้เย็นให้ครอบครัวใช้งาน"
          : "Set up your family fridge"}
      </h2>
      <ol>
        <li>
          {language === "th"
            ? "เชื่อม LINE ของครอบครัวด้านบน"
            : "Connect your family LINE above"}
        </li>
        <li>
          {language === "th"
            ? "นำโทเคนกล้องด้านล่างไปตั้งค่า Gateway"
            : "Configure your gateway with its camera token below"}
        </li>
        <li>
          {language === "th"
            ? "เพิ่มอีเมล Google ของสมาชิก ทุกคนใช้บัญชีของตัวเอง"
            : "Add each family member’s Google email; everyone signs in with their own account"}
        </li>
        <li>
          {language === "th"
            ? "เปิดหน้าอุปกรณ์เพื่อดูว่ามีข้อมูลเข้าจริง และให้แต่ละคนตั้ง LINE ส่วนตัวในหน้าของฉัน"
            : "Verify real device reports and let each person connect LINE under Me"}
        </li>
      </ol>
    </section>
  );
}
function GeneralSettings({ view }: { view: SettingsView }) {
  const {
    t,
    settings,
    busy,
    name,
    setName,
    geminiKeyInput,
    setGeminiKeyInput,
    saveGeneral,
    clearGeminiKey,
  } = view;
  return (
    <section className="surface add-form" aria-labelledby="general-title">
      <h2 id="general-title">{t.generalSettings}</h2>
      <form onSubmit={(event) => void saveGeneral(event)}>
        <fieldset disabled={busy}>
          <label>
            {t.fridgeName}
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={80}
            />
          </label>
          <label>
            {t.geminiKey}
            <input
              type="password"
              value={geminiKeyInput}
              onChange={(event) => setGeminiKeyInput(event.target.value)}
              maxLength={256}
              placeholder={t.geminiKeyPlaceholder}
              autoComplete="off"
            />
          </label>
          {settings.hasGeminiApiKey && (
            <div className="inline-note">
              <span className="small">{t.geminiKeySaved}</span>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void clearGeminiKey()}
              >
                {t.clearGeminiKey}
              </button>
            </div>
          )}
        </fieldset>
        <div className="form-actions">
          <button className="primary" disabled={busy} type="submit">
            {busy ? t.saving : t.save}
          </button>
        </div>
      </form>
    </section>
  );
}
function GatewaySettings({ view }: { view: SettingsView }) {
  const {
    t,
    settings,
    busy,
    showToken,
    setShowToken,
    copied,
    copyToken,
    rotateToken,
  } = view;
  const maskedToken =
    settings.gatewayToken.slice(0, 10) +
    "••••••••••••••••" +
    settings.gatewayToken.slice(-4);
  return (
    <section className="surface settings-card" aria-labelledby="token-title">
      <h2 id="token-title">{t.gatewayToken}</h2>
      <p className="small">{t.gatewayTokenHelp}</p>
      <code className="token-box">
        {showToken ? settings.gatewayToken : maskedToken}
      </code>
      <div className="form-actions">
        <button
          type="button"
          className="secondary"
          onClick={() => setShowToken((prev) => !prev)}
        >
          {showToken ? t.hideToken : t.showToken}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => void copyToken()}
        >
          {copied ? t.copied : t.copyToken}
        </button>
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={() => void rotateToken()}
        >
          {t.rotateToken}
        </button>
      </div>
    </section>
  );
}
function MemberSettings({ view }: { view: SettingsView }) {
  const {
    t,
    settings,
    busy,
    inviteEmail,
    setInviteEmail,
    inviteRole,
    setInviteRole,
    removeMember,
    inviteMember,
    language,
    fridgeId,
  } = view;
  const ownerCount = settings.members.filter((m) => m.role === "owner").length;
  return (
    <section className="surface settings-card" aria-labelledby="members-title">
      <h2 id="members-title">{t.members}</h2>
      <p className="small">
        {language === "th"
          ? "เพิ่มอีเมลเพื่อให้สิทธิ์ จากนั้นส่งลิงก์เว็บให้สมาชิกเข้าด้วย Google อีเมลเดียวกัน ระบบไม่ได้ส่งอีเมลเชิญให้อัตโนมัติ"
          : "Add an email to grant access, then share this link. Sign in with the same Google email. Invitation emails are not sent automatically."}
      </p>
      <button
        type="button"
        className="secondary"
        onClick={() =>
          void navigator.clipboard
            .writeText(
              new URL(
                "/fridges/" + encodeURIComponent(fridgeId),
                window.location.origin,
              ).href,
            )
            .then(() =>
              toast.success(language === "th" ? "คัดลอกลิงก์แล้ว" : "Link copied"),
            )
            .catch(() =>
              toast.error(
                language === "th"
                  ? "คัดลอกไม่ได้ กรุณาคัดลอกจากแถบที่อยู่"
                  : "Copy the link from your address bar",
              ),
            )
        }
      >
        {language === "th" ? "คัดลอกลิงก์ให้ครอบครัว" : "Copy family link"}
      </button>
      <ul className="member-list">
        {settings.members.map((member) => {
          const isLastOwner = member.role === "owner" && ownerCount <= 1;
          return (
            <li key={member.email} className="member-row">
              <div>
                <strong>{member.email}</strong>
                <span className="badge">
                  {member.role === "owner" ? t.ownerBadge : t.memberBadge}
                </span>
              </div>
              <button
                type="button"
                className="secondary"
                disabled={busy || isLastOwner}
                onClick={() => void removeMember(member.email)}
              >
                {t.removeMember}
              </button>
            </li>
          );
        })}
      </ul>
      <form
        className="invite-form"
        onSubmit={(event) => void inviteMember(event)}
      >
        <input
          type="email"
          value={inviteEmail}
          onChange={(event) => setInviteEmail(event.target.value)}
          aria-label={t.inviteEmail}
          placeholder={t.inviteEmail}
          required
        />
        <Select
          value={inviteRole}
          onValueChange={(value) =>
            setInviteRole(value === "owner" ? "owner" : "member")
          }
        >
          <SelectTrigger aria-label={t.inviteRole}>
            <SelectValue>
              {inviteRole === "owner" ? t.ownerBadge : t.memberBadge}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="member">{t.memberBadge}</SelectItem>
            <SelectItem value="owner">{t.ownerBadge}</SelectItem>
          </SelectContent>
        </Select>
        <button className="primary" disabled={busy} type="submit">
          {t.inviteMember}
        </button>
      </form>
    </section>
  );
}
function DangerZone({ view }: { view: SettingsView }) {
  const { t, busy, removeFridge } = view;
  return (
    <section className="surface danger-zone" aria-labelledby="danger-title">
      <h2 id="danger-title">{t.dangerZone}</h2>
      <div className="form-actions">
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={() => void removeFridge()}
        >
          {t.deleteFridge}
        </button>
      </div>
    </section>
  );
}
export function Settings(props: {
  fridgeId: string;
  language: Language;
  onFridgesChanged: () => void;
}) {
  const controller = useSettings(props);
  const { t, settings, loading, notice, error } = controller;
  if (loading) return <p role="status">{t.loading}</p>;
  if (!settings) return <StatusAlert>{error ?? t.failed}</StatusAlert>;
  const view = {
    ...controller,
    settings,
    language: props.language,
    fridgeId: props.fridgeId,
  };
  return (
    <div className="settings-stack">
      <h1>{t.settings}</h1>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {error && <StatusAlert>{error}</StatusAlert>}
      <LineConnection language={props.language} fridgeId={props.fridgeId} />
      <FamilySetupGuide view={view} />
      <GeneralSettings view={view} />
      <GatewaySettings view={view} />
      <MemberSettings view={view} />
      <DangerZone view={view} />
    </div>
  );
}
