import {
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  KeyRound,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import useSWR from "swr";
import { LineConnection } from "./LineConnection";
import { useConfirm } from "./components/confirmation";
import { StatusAlert } from "./components/status-alert";
import { getJson, swrOptions, isAccessError } from "./lib/api";
import { useLineStatus } from "./line-data";
import { readFridgeSettings } from "./model";
import type { FridgeSettings, Language, MemberRole } from "./model";
import { computeSetupProgress } from "./state/dashboard-machine";
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
  const lineStatus = useLineStatus(`${baseUrl}/line`);
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
      void navigate("/fridges", { replace: true });
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
    lineLinked: Boolean(lineStatus.data?.linked),
    loading,
    loadSettings,
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
  hasDevices: boolean;
};

function FamilySetupGuide({ view }: { view: SettingsView }) {
  const { language, lineLinked, settings, hasDevices } = view;
  const th = language === "th";
  const progress = computeSetupProgress({
    lineLinked,
    hasDevices,
    memberCount: settings.members.length,
    hasGeminiKey: settings.hasGeminiApiKey,
  });

  const stepList = [
    {
      done: progress.steps.fridgeCreated,
      label: th ? "สร้างตู้เย็นแล้ว" : "Fridge created",
    },
    {
      done: progress.steps.lineLinked,
      label: th ? "เชื่อม LINE ของครอบครัว" : "Connect family LINE",
    },
    {
      done: progress.steps.hasDevices,
      label: th
        ? "เชื่อม Gateway ด้วยโทเคนและรับข้อมูลจริง"
        : "Connect gateway with token & verify device heartbeat",
    },
    {
      done: progress.steps.hasFamilyOrKey,
      label: th
        ? "เชิญคนในครอบครัว หรือใส่ Gemini API key"
        : "Invite family members or add Gemini API key",
    },
  ];

  return (
    <section className="panel flex flex-col gap-3">
      <div className="page-head">
        <div>
          <h2>
            {th ? "เตรียมตู้เย็นให้ครอบครัวใช้งาน" : "Set up your family fridge"}
          </h2>
          <p className="sub">
            {th
              ? `คืบหน้าแล้ว ${progress.completed} จาก ${progress.total} ขั้นตอน`
              : `${progress.completed} of ${progress.total} setup steps complete`}
          </p>
        </div>
        <span className="pill accent num">{progress.percent}%</span>
      </div>
      <div className="progress-track" aria-hidden="true">
        <div
          className="progress-fill"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      <ul className="setup-steps">
        {stepList.map((step) => (
          <li
            key={step.label}
            className={`setup-step${step.done ? "done" : ""}`}
          >
            {step.done ? (
              <CheckCircle2 size={18} aria-hidden="true" />
            ) : (
              <Circle size={18} aria-hidden="true" />
            )}
            <span>{step.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function GeneralSettings({ view }: { view: SettingsView }) {
  const { t, busy, name, setName, saveGeneral } = view;
  const th = view.language === "th";
  return (
    <section
      className="panel flex flex-col gap-3"
      aria-labelledby="general-title"
    >
      <h2 id="general-title">{th ? "ข้อมูลตู้เย็น" : "Fridge details"}</h2>
      <form
        className="add-form fridge-name-form"
        onSubmit={(event) => void saveGeneral(event)}
      >
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

function GatewayTokenAccordionItem({
  view,
  expanded,
  onToggle,
}: {
  view: SettingsView;
  expanded: boolean;
  onToggle: () => void;
}) {
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
    <div className="conn">
      <button
        type="button"
        className="conn-row"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="connection-icon" aria-hidden="true">
          <Camera size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block">{t.gatewayToken}</strong>
          <span className="small">{t.gatewayTokenHelp}</span>
        </span>
        {expanded ? (
          <ChevronDown size={18} aria-hidden="true" />
        ) : (
          <ChevronRight size={18} aria-hidden="true" />
        )}
      </button>

      {expanded && (
        <div className="conn-body">
          <code className="connection-token">
            {showToken ? settings.gatewayToken : maskedToken}
          </code>
          <div className="form-actions">
            <button
              type="button"
              className="text-action"
              onClick={() => setShowToken((prev) => !prev)}
            >
              <KeyRound size={16} aria-hidden="true" />
              {showToken ? t.hideToken : t.showToken}
            </button>
            <button
              type="button"
              className="text-action"
              onClick={() => void copyToken()}
            >
              <Copy size={16} aria-hidden="true" />
              {copied ? t.copied : t.copyToken}
            </button>
            <button
              type="button"
              className="text-action text-action-danger"
              disabled={busy}
              onClick={() => void rotateToken()}
            >
              <RotateCcw size={16} aria-hidden="true" />
              {t.rotateToken}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function GeminiKeyAccordionItem({
  view,
  expanded,
  onToggle,
}: {
  view: SettingsView;
  expanded: boolean;
  onToggle: () => void;
}) {
  const {
    t,
    settings,
    busy,
    geminiKeyInput,
    setGeminiKeyInput,
    saveGeneral,
    clearGeminiKey,
    language,
  } = view;
  const th = language === "th";
  const statusSubtitle = settings.hasGeminiApiKey
    ? t.geminiKeySaved
    : th
      ? "ยังไม่ตั้งค่าคีย์ส่วนตัว"
      : "No custom key saved";

  return (
    <div className="conn">
      <button
        type="button"
        className="conn-row"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="connection-icon" aria-hidden="true">
          <Sparkles size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block">{t.geminiKey}</strong>
          <span className="small">{statusSubtitle}</span>
        </span>
        {expanded ? (
          <ChevronDown size={18} aria-hidden="true" />
        ) : (
          <ChevronRight size={18} aria-hidden="true" />
        )}
      </button>

      {expanded && (
        <form
          className="conn-body add-form"
          onSubmit={(event) => void saveGeneral(event)}
        >
          <fieldset disabled={busy}>
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
          </fieldset>
          <div className="form-actions">
            <button className="primary sm" disabled={busy} type="submit">
              {busy ? t.saving : t.save}
            </button>
            {settings.hasGeminiApiKey && (
              <button
                type="button"
                className="text-action text-action-danger"
                disabled={busy}
                onClick={() => void clearGeminiKey()}
              >
                {t.clearGeminiKey}
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

function ConnectionsAccordion({ view }: { view: SettingsView }) {
  const th = view.language === "th";
  const [openKey, setOpenKey] = useState<"gateway" | "gemini" | null>(null);

  return (
    <section className="panel flex flex-col gap-3">
      <div>
        <h2>{th ? "การเชื่อมต่ออุปกรณ์และ AI" : "Connections"}</h2>
        <p className="sub">
          {th
            ? "โทเคนสำหรับ Raspberry Pi Gateway และ Gemini API Key"
            : "Camera gateway Bearer token and optional Gemini AI key."}
        </p>
      </div>

      <div className="conns">
        <GatewayTokenAccordionItem
          view={view}
          expanded={openKey === "gateway"}
          onToggle={() =>
            setOpenKey((prev) => (prev === "gateway" ? null : "gateway"))
          }
        />
        <GeminiKeyAccordionItem
          view={view}
          expanded={openKey === "gemini"}
          onToggle={() =>
            setOpenKey((prev) => (prev === "gemini" ? null : "gemini"))
          }
        />
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
    <section
      className="panel flex flex-col gap-3"
      aria-labelledby="members-title"
    >
      <div className="page-head">
        <div>
          <h2 id="members-title">{t.members}</h2>
          <p className="sub">
            {language === "th"
              ? "เพิ่มอีเมลเพื่อให้สิทธิ์ จากนั้นส่งลิงก์เว็บให้สมาชิกเข้าด้วย Google อีเมลเดียวกัน"
              : "Add an email to grant access, then share this link for Google sign-in."}
          </p>
        </div>
        <button
          type="button"
          className="btn sm"
          onClick={() =>
            void navigator.clipboard
              .writeText(
                new URL(
                  "/fridges/" + encodeURIComponent(fridgeId),
                  window.location.origin,
                ).href,
              )
              .then(() =>
                toast.success(
                  language === "th" ? "คัดลอกลิงก์แล้ว" : "Link copied",
                ),
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
          <Copy size={15} aria-hidden="true" />
          {language === "th" ? "คัดลอกลิงก์ให้ครอบครัว" : "Copy family link"}
        </button>
      </div>

      <ul className="member-list">
        {settings.members.map((member) => {
          const isLastOwner = member.role === "owner" && ownerCount <= 1;
          return (
            <li key={member.email} className="member-row">
              <div className="flex flex-wrap items-center gap-2">
                <strong>{member.email}</strong>
                <span className="small">
                  {member.role === "owner" ? t.ownerBadge : t.memberBadge}
                </span>
              </div>
              <button
                type="button"
                className="text-action text-action-danger"
                disabled={busy || isLastOwner}
                onClick={() => void removeMember(member.email)}
              >
                <Trash2 size={16} aria-hidden="true" />
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
        <label className="invite-email">
          {t.inviteEmail}
          <input
            type="email"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <fieldset className="visible-choices invite-role" disabled={busy}>
          <legend>{t.inviteRole}</legend>
          <div>
            <label>
              <input
                type="radio"
                name="invite-role"
                checked={inviteRole === "member"}
                onChange={() => setInviteRole("member")}
              />
              <span>
                {t.memberBadge}
                <small>
                  {language === "th"
                    ? "ดูและจัดการอาหาร"
                    : "View and manage food"}
                </small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="invite-role"
                checked={inviteRole === "owner"}
                onChange={() => setInviteRole("owner")}
              />
              <span>
                {t.ownerBadge}
                <small>
                  {language === "th"
                    ? "จัดการสมาชิกและการตั้งค่าด้วย"
                    : "Also manage members and settings"}
                </small>
              </span>
            </label>
          </div>
        </fieldset>
        <button className="primary" disabled={busy} type="submit">
          {t.inviteMember}
        </button>
      </form>
    </section>
  );
}

function DangerZone({ view }: { view: SettingsView }) {
  const { t, busy, removeFridge, language } = view;
  return (
    <section
      className="panel flex flex-col gap-3"
      aria-labelledby="danger-title"
    >
      <h2 id="danger-title" className="text-[var(--bad)]">
        {t.dangerZone}
      </h2>
      <p className="sub">
        {language === "th"
          ? "การลบตู้เย็นจะลบข้อมูลอาหาร ค่าเซนเซอร์ และรูปภาพทั้งหมดอย่างถาวร"
          : "Deleting this fridge permanently removes all food items, telemetry, and photos."}
      </p>
      <div className="form-actions">
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={() => void removeFridge()}
        >
          <Trash2 size={17} aria-hidden="true" />
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
  hasDevices?: boolean;
}) {
  const controller = useSettings(props);
  const { t, settings, loading, loadSettings, notice, error } = controller;
  const th = props.language === "th";

  if (loading) return <output className="sub">{t.loading}</output>;
  if (!settings) {
    return (
      <StatusAlert
        action={
          <button
            type="button"
            className="btn sm"
            onClick={() => void loadSettings()}
          >
            <RotateCcw size={15} aria-hidden="true" />
            {th ? "ลองใหม่" : "Retry"}
          </button>
        }
      >
        {error ?? t.failed}
      </StatusAlert>
    );
  }

  const view: SettingsView = {
    ...controller,
    settings,
    language: props.language,
    fridgeId: props.fridgeId,
    hasDevices: Boolean(props.hasDevices),
  };

  return (
    <div className="settings">
      <h1>{t.settings}</h1>
      {notice && <output className="pill accent">{notice}</output>}
      {error && <StatusAlert>{error}</StatusAlert>}
      <GeneralSettings view={view} />
      {!view.hasDevices && <FamilySetupGuide view={view} />}
      <MemberSettings view={view} />
      <LineConnection
        language={props.language}
        fridgeId={props.fridgeId}
        fridgeName={settings.name}
      />
      <ConnectionsAccordion view={view} />
      <DangerZone view={view} />
    </div>
  );
}
