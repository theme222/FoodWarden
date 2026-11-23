import { Languages, LogOut } from "lucide-react";
import { Tooltip } from "@base-ui/react/tooltip";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import type { SessionUser } from "../auth";
import { FridgeLogo } from "../icons";
import type { Language } from "../model";
import { words } from "../words";

function ToolbarHint({ label, control }: { label: string; control: ReactElement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={control} aria-label={label} />
      <Tooltip.Portal>
        <Tooltip.Positioner side="bottom" sideOffset={5} className="toolbar-hint-position">
          <Tooltip.Popup className="toolbar-hint">{label}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function DashboardHeader({
  user,
  language,
  onLanguageChange,
  onSignOut,
}: {
  user: SessionUser | null | undefined;
  language: Language;
  onLanguageChange: () => void;
  onSignOut: () => Promise<void>;
}) {
  const t = words[language];
  const th = language === "th";
  const initial = (user?.name || user?.email || "F").slice(0, 1).toUpperCase();
  return (
    <header className="top">
      <div className="top-in">
        <Link to="/fridges" className="brand" aria-label="FoodWarden">
          <FridgeLogo />
          <span className="brand-name">FoodWarden</span>
        </Link>
        <div className="header-actions">
          {user && (
            <a href="/api/reference" className="btn sm api-ref-link">
              {th ? "เอกสาร API" : "API reference"}
            </a>
          )}
          <Tooltip.Provider>
            <ToolbarHint
              label={th ? "เปลี่ยนเป็นภาษาอังกฤษ" : "Switch to Thai"}
              control={
                <button className="toolbar-icon" type="button" onClick={onLanguageChange}>
                  <Languages size={21} aria-hidden="true" />
                </button>
              }
            />
            {user && (
              <>
                <ToolbarHint
                  label={th ? "บัญชีและการแจ้งเตือนของฉัน" : "My account and notifications"}
                  control={
                    <Link className="toolbar-icon toolbar-account" to="/me">
                      <span className="user-avatar" aria-hidden="true">{initial}</span>
                    </Link>
                  }
                />
                <ToolbarHint
                  label={t.signOut}
                  control={
                    <button className="toolbar-icon" type="button" onClick={() => void onSignOut()}>
                      <LogOut size={21} aria-hidden="true" />
                    </button>
                  }
                />
              </>
            )}
          </Tooltip.Provider>
        </div>
      </div>
    </header>
  );
}
