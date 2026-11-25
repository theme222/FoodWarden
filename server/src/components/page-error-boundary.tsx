import { Component } from "react";
import type { ReactNode } from "react";
import type { Language } from "../model";
import { StatusAlert } from "./status-alert";
import { Button } from "./ui/button";

export class PageErrorBoundary extends Component<
  { language: Language; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    const th = this.props.language === "th";
    return (
      <StatusAlert
        action={
          <Button type="button" onClick={() => window.location.reload()}>
            {th ? "โหลดหน้าใหม่" : "Reload page"}
          </Button>
        }
      >
        {th ? "หน้านี้แสดงผลไม่สำเร็จ" : "This page could not be displayed."}
      </StatusAlert>
    );
  }
}
