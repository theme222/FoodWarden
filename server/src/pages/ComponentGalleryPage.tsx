import {
  lazy,
  memo,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Toggle, ToggleGroup } from "@ui-sdk/react/toggle";
import {
  AlertTriangle,
  Bell,
  Check,
  Copy,
  Edit3,
  Loader2,
  MessageCircle,
  Palette,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirmation";
import { InventoryRow } from "@/components/inventory-row";
import { FavoriteStar } from "@/FavoriteToggle";
import { ReadingTime } from "@/components/reading-time";
import { StatusAlert } from "@/components/status-alert";
import { ThemeLanguagePicker } from "@/components/theme-picker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Devices } from "@/Devices";
import { FridgeLogo } from "@/icons";
import { Metrics } from "@/Metrics";
import type { DoorEvent, Heartbeat, Language, Sample } from "@/model";
import { SignInPanel } from "@/pages/SignInPage";
import { Sheet } from "@/Sheet";
import type { ColorTheme } from "@/state/dashboard-machine";
import { COLOR_THEMES, THEME_META } from "@/theme";
import { words } from "@/words";

const GallerySensorPlot = lazy(() => import("./GallerySensorPlot"));

const BUTTON_VARIANTS = [
  "default",
  "secondary",
  "primary",
  "take",
  "destructive",
  "dangerGhost",
  "lime",
  "google",
  "outline",
  "ghost",
  "link",
] as const;

const BUTTON_SIZES = ["xs", "sm", "default", "big", "google"] as const;

const ICON_BUTTON_SIZES = ["icon-xs", "icon-sm", "icon", "icon-lg"] as const;

const DOOR_STATUSES: DoorEvent["status"][] = [
  "CLOSING",
  "SUCCESS",
  "OBSTRUCTION_ERROR",
  "ABORTED",
  "TIMEOUT_ERROR",
  "FAULT_LOCKOUT",
  "CONTRADICTION_ERROR",
];

type DeviceDemoMode = "healthy" | "degraded" | "unknown" | "loading" | "error";

interface DemoInventoryItem {
  id: string;
  emoji: string;
  nameTh: string;
  nameEn: string;
  categoryTh: string;
  categoryEn: string;
  state: "fresh" | "soon" | "expired";
  badgeTh: string;
  badgeEn: string;
  expiryTextTh: string;
  expiryTextEn: string;
  qty: number;
  favorite: boolean;
  busy?: boolean;
}

const GALLERY_REVEAL_EVENT = "gallery-reveal-all";

function DeferredBody({ children }: { children: React.ReactNode }) {
  const host = useRef<HTMLDivElement | null>(null);
  const [revealed, setRevealed] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    const node = host.current;
    const reveal = () => setRevealed(true);
    window.addEventListener(GALLERY_REVEAL_EVENT, reveal);
    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== "undefined" && node) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            setRevealed(true);
            observer?.disconnect();
          }
        },
        { rootMargin: "1200px 0px" },
      );
      observer.observe(node);
    }
    return () => {
      window.removeEventListener(GALLERY_REVEAL_EVENT, reveal);
      observer?.disconnect();
    };
  }, []);
  if (revealed) return <>{children}</>;
  return <div ref={host} aria-hidden="true" style={{ minHeight: "10rem" }} />;
}

function SectionCard({
  id,
  title,
  subtitle,
  eager = false,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  eager?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      tabIndex={-1}
      className="panel grid min-w-0 scroll-mt-6 grid-cols-1 gap-4 [contain-intrinsic-block-size:auto_24rem] [content-visibility:auto]"
      aria-labelledby={`${id}-title`}
    >
      <div className="grid gap-1">
        <h2 id={`${id}-title`} className="text-xl font-bold">
          {title}
        </h2>
        {subtitle ? <p className="small">{subtitle}</p> : null}
      </div>
      {eager ? children : <DeferredBody>{children}</DeferredBody>}
    </section>
  );
}

export const ComponentGalleryPage = memo(function ComponentGalleryPage({
  language,
  colorTheme,
  onLanguageChange,
  onColorThemeChange,
}: {
  language: Language;
  colorTheme: ColorTheme;
  onLanguageChange: (next: Language) => void;
  onColorThemeChange: (next: ColorTheme) => void;
}) {
  const th = language === "th";
  const confirm = useConfirm();
  const { hash } = useLocation();

  useEffect(() => {
    const id = hash.slice(1);
    if (!Object.hasOwn(GALLERY_NAV, id)) return;
    window.dispatchEvent(new Event(GALLERY_REVEAL_EVENT));
    const focusSection = () => {
      const section = document.getElementById(id);
      section?.scrollIntoView({ block: "start" });
      section?.focus({ preventScroll: true });
    };
    focusSection();
    const frame = requestAnimationFrame(focusSection);
    const timer = window.setTimeout(focusSection, 200);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [hash]);

  const [confirmResult, setConfirmResult] = useState<string>("—");
  const [now] = useState(() => Math.floor(Date.now() / 1000));

  const healthyDoor: DoorEvent[] = [
    { nodeId: "D0", timestampS: now - 120, status: "SUCCESS" },
  ];

  const alertDoor: DoorEvent[] = [
    { nodeId: "D0", timestampS: now - 45, status: "OBSTRUCTION_ERROR" },
  ];

  async function triggerConfirm(tone: "destructive" | "take") {
    const copy = GALLERY_CONFIRM_COPY[language];
    const { message, label } = copy[tone];
    const accepted = await confirm(message, label, tone);
    setConfirmResult(accepted ? copy.accepted : copy.cancelled);
    return accepted;
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6 pb-12">
      <section className="panel grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-1">
            <div className="flex items-center gap-2">
              <FridgeLogo />
              <h1>
                {th ? "คลังคอมโพเนนต์และสถานะ" : "Component & State Gallery"}
              </h1>
            </div>
            <p className="sub">
              {th
                ? "ทดลองคอมโพเนนต์หลักของ FoodWarden และสถานะต่าง ๆ ด้วยข้อมูลตัวอย่าง"
                : "Try FoodWarden’s shared components and key states with sample data."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={language === "th" ? "primary" : "secondary"}
              aria-pressed={language === "th"}
              onClick={() => onLanguageChange("th")}
            >
              TH
            </Button>
            <Button
              size="sm"
              variant={language === "en" ? "primary" : "secondary"}
              aria-pressed={language === "en"}
              onClick={() => onLanguageChange("en")}
            >
              EN
            </Button>
            {COLOR_THEMES.map((theme) => (
              <Button
                key={theme}
                size="sm"
                variant={colorTheme === theme ? "lime" : "secondary"}
                aria-pressed={colorTheme === theme}
                onClick={() => onColorThemeChange(theme)}
              >
                <span
                  className="inline-block size-3 rounded-full"
                  style={{ backgroundColor: THEME_META[theme].accent }}
                  aria-hidden="true"
                />
                {th ? THEME_META[theme].th : THEME_META[theme].en}
              </Button>
            ))}
          </div>
        </div>

        <GalleryIndex language={language} />
      </section>

      <GalleryToggle th={th} />

      <GalleryButtons th={th} />

      <GalleryAlerts language={language} />

      <GalleryOverlays
        language={language}
        confirmResult={confirmResult}
        triggerConfirm={triggerConfirm}
      />

      <GalleryControls
        language={language}
        colorTheme={colorTheme}
        onLanguageChange={onLanguageChange}
        onColorThemeChange={onColorThemeChange}
      />

      <GalleryForm th={th} />

      <GalleryTable language={language} now={now} />

      <GalleryMetrics
        language={language}
        now={now}
        healthyDoor={healthyDoor}
        alertDoor={alertDoor}
      />

      <GalleryDevices
        language={language}
        now={now}
        healthyDoor={healthyDoor}
        alertDoor={alertDoor}
      />

      <GalleryCharts language={language} />

      <GalleryInventoryAndLine
        language={language}
        triggerConfirm={triggerConfirm}
      />

      <GalleryTheme language={language} colorTheme={colorTheme} />

      <GallerySignIn language={language} />
    </div>
  );
});

type GalleryConfirm = (tone: "destructive" | "take") => Promise<boolean>;

const GALLERY_NAV = {
  "ui-sdk": { th: "UI SDK", en: "UI SDK" },
  buttons: { th: "1. ปุ่ม (Buttons)", en: "1. Buttons" },
  alerts: { th: "2. แจ้งเตือน & Toast", en: "2. Alerts & Toasts" },
  overlays: { th: "3. Dialog & Confirm", en: "3. Overlays" },
  controls: { th: "4. Tabs & Select", en: "4. Tabs & Select" },
  "form-primitives": {
    th: "4.5 Form & Card (shadcn)",
    en: "4.5 Form & Card (shadcn)",
  },
  table: { th: "5. ตาราง & เวลา", en: "5. Table & Time" },
  metrics: { th: "6. เซนเซอร์ (Metrics)", en: "6. Metrics" },
  devices: { th: "7. แผนผังอุปกรณ์", en: "7. Devices" },
  charts: { th: "8. กราฟเซนเซอร์", en: "8. Sensor Chart" },
  "inventory-qr": {
    th: "9. รายการอาหาร & LINE QR",
    en: "9. Inventory & LINE QR",
  },
  domain: { th: "10. สถานะอาหาร & ประตู", en: "10. Badges & Door" },
  signin: { th: "11. หน้าเข้าสู่ระบบ", en: "11. Sign-In" },
};

const GALLERY_GROUPS = [
  {
    th: "คอมโพเนนต์พื้นฐาน",
    en: "Components",
    ids: [
      "ui-sdk",
      "buttons",
      "alerts",
      "overlays",
      "controls",
      "form-primitives",
      "table",
    ],
  },
  {
    th: "ตัวอย่างการใช้งาน",
    en: "User flows",
    ids: ["metrics", "devices", "charts", "inventory-qr", "domain", "signin"],
  },
] as const;

const GALLERY_KEYWORDS: Partial<Record<keyof typeof GALLERY_NAV, string>> = {
  "ui-sdk": "toggle star favorite ดาว รายการโปรด",
  buttons: "loading busy disabled icon submit",
  alerts: "toast error warning success status",
  overlays: "dialog sheet modal alert dialog confirmation",
  controls: "select tabs preferences language",
  "form-primitives":
    "input label checkbox switch badge card separator skeleton validation ฟอร์ม ช่องกรอก",
  table: "empty loading rows no data filters ตาราง ว่าง",
  charts: "recharts temperature voc partial empty range",
  "inventory-qr": "line qr clipboard item favorite quantity expiry",
  signin: "sign-in authentication auth login Google เข้าสู่ระบบ",
};

function GalleryIndex({ language }: { language: Language }) {
  const th = language === "th";
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const search = query.trim().toLowerCase();
  const groups = GALLERY_GROUPS.map(({ ids, ...name }) => ({
    name: name[language],
    ids: ids.filter((id) =>
      [
        id,
        GALLERY_NAV[id].th,
        GALLERY_NAV[id].en,
        GALLERY_KEYWORDS[id] ?? "",
      ].some((label) => label.toLowerCase().includes(search)),
    ),
  }));
  const total = groups.reduce((sum, group) => sum + group.ids.length, 0);
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="gallery-search">
          {th ? "ค้นหาหมวดตัวอย่าง" : "Find a demo section"}
        </Label>
        <div className="flex flex-wrap gap-2">
          <Input
            ref={searchInput}
            id="gallery-search"
            type="search"
            autoComplete="off"
            className="min-w-36 flex-1"
            value={query}
            placeholder={
              th ? "เช่น กราฟ หรือ LINE" : "For example, charts or LINE"
            }
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <Button
              size="sm"
              onClick={() => {
                setQuery("");
                searchInput.current?.focus();
              }}
            >
              {th ? "ล้าง" : "Clear"}
            </Button>
          )}
        </div>
        <output className="small" aria-live="polite">
          {search && (th ? `พบ ${total} หมวด` : `${total} sections found`)}
        </output>
      </div>
      <nav
        className="grid gap-3 sm:grid-cols-2"
        aria-label={th ? "ลิงก์ข้ามหมวด" : "Section navigation"}
      >
        {groups
          .filter(({ ids }) => ids.length > 0)
          .map(({ name, ids }) => (
            <details
              key={name}
              className="min-w-0"
              open={search ? true : undefined}
            >
              <summary className="min-h-11 cursor-pointer rounded-md bg-secondary px-3 py-2.5 text-sm font-semibold">
                {name}
                <span className="ml-1.5 font-normal text-muted-foreground">
                  ({ids.length})
                </span>
              </summary>
              <ul className="mt-2 flex list-none flex-wrap gap-2 p-0">
                {ids.map((id) => (
                  <li key={id}>
                    <a href={`#${id}`} className="btn sm">
                      {GALLERY_NAV[id][language].replace(
                        /^\d+(?:\.\d+)?\.?\s+/,
                        "",
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          ))}
      </nav>
    </div>
  );
}

const GALLERY_CONFIRM_COPY = {
  th: {
    take: {
      message: "ยืนยันการหยิบอาหารออกจากตู้เย็นใช่หรือไม่?",
      label: "หยิบออก",
    },
    destructive: {
      message: "การกระทำนี้จะลบข้อมูลถาวร ต้องการดำเนินการต่อหรือไม่?",
      label: "ลบข้อมูล",
    },
    accepted: "ยืนยัน (Accepted)",
    cancelled: "ยกเลิก (Cancelled)",
  },
  en: {
    take: {
      message: "Confirm taking this item out of the fridge?",
      label: "Take out",
    },
    destructive: {
      message: "This action permanently deletes data. Continue?",
      label: "Delete",
    },
    accepted: "Accepted",
    cancelled: "Cancelled",
  },
};

function GalleryToggle({ th }: { th: boolean }) {
  const [favorite, setFavorite] = useState(false);
  return (
    <SectionCard id="ui-sdk" title="UI SDK" eager>
      <Card size="sm">
        <CardContent className="flex items-center justify-between gap-3">
          <span>{th ? "นมสด" : "Fresh milk"}</span>
          <FavoriteStar
            name={th ? "นมสด" : "Fresh milk"}
            language={th ? "th" : "en"}
            pressed={favorite}
            onToggle={() => setFavorite((previous) => !previous)}
          />
        </CardContent>
      </Card>
    </SectionCard>
  );
}

function GalleryButtons({ th }: { th: boolean }) {
  return (
    <SectionCard
      id="buttons"
      title={th ? "1. ปุ่ม (Button Variants, Sizes & States)" : "1. Buttons"}
      subtitle={
        th
          ? "วางบนพื้นหลังแอปเพื่อให้เห็นขอบปุ่มสีขาว (default, google) และปุ่มโปร่งใส (ghost) ชัดเจน"
          : "Placed on app background surface so white (default, google) and transparent (ghost) buttons stay crisp."
      }
    >
      <div className="grid gap-3">
        <h3 className="text-sm font-semibold text-muted-foreground">
          Variants (Normal vs Disabled)
        </h3>
        <div className="grid gap-3 rounded-2xl bg-[var(--bg)] p-4">
          <div className="flex flex-wrap items-center gap-2.5">
            {BUTTON_VARIANTS.map((variant) => (
              <Button key={variant} variant={variant}>
                {variant}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            {BUTTON_VARIANTS.map((variant) => (
              <Button key={`${variant}-disabled`} variant={variant} disabled>
                {variant} (disabled)
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 pt-1">
        <h3 className="text-sm font-semibold text-muted-foreground">
          Sizes & States (With Icon / Loading)
        </h3>
        <div className="flex flex-wrap items-center gap-2.5 rounded-2xl bg-[var(--bg)] p-4">
          {BUTTON_SIZES.map((size) => (
            <Button key={size} size={size} variant="primary">
              <Plus aria-hidden="true" />
              size={size}
            </Button>
          ))}
          <Button variant="primary" disabled>
            <Loader2 className="animate-spin" aria-hidden="true" />
            {th ? "กำลังบันทึก..." : "Saving..."}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 pt-1">
        <h3 className="text-sm font-semibold text-muted-foreground">
          Icon Buttons (iconEdit, iconDelete, close)
        </h3>
        <div className="flex flex-wrap items-center gap-2.5 rounded-2xl bg-[var(--bg)] p-4">
          {ICON_BUTTON_SIZES.map((size) => (
            <Button
              key={`edit-${size}`}
              variant="iconEdit"
              size={size}
              aria-label={`Edit ${size}`}
            >
              <Edit3 aria-hidden="true" />
            </Button>
          ))}
          {ICON_BUTTON_SIZES.map((size) => (
            <Button
              key={`del-${size}`}
              variant="iconDelete"
              size={size}
              aria-label={`Delete ${size}`}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          ))}
          <Button variant="secondary" size="close" aria-label="Close">
            <X aria-hidden="true" />
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

function GalleryAlerts({ language }: { language: Language }) {
  const th = language === "th";
  const t = words[language];
  return (
    <SectionCard
      id="alerts"
      title={
        th
          ? "2. กล่องแจ้งเตือน (Alert, StatusAlert & Sonner Toast)"
          : "2. Alerts & Toasts"
      }
    >
      <div className="grid gap-3">
        {(
          ["default", "destructive", "warning", "success", "soft"] as const
        ).map((variant) => (
          <Alert key={variant} variant={variant}>
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <Sparkles aria-hidden="true" />
              <div className="grid gap-0.5">
                <AlertTitle>Alert variant: {variant}</AlertTitle>
                <AlertDescription>
                  {th
                    ? "ตัวอย่างข้อความแจ้งเตือนสำหรับสถานะ " + variant
                    : `Example alert description for the ${variant} state.`}
                </AlertDescription>
              </div>
            </div>
          </Alert>
        ))}
      </div>

      <div className="grid gap-3 pt-2">
        <h3 className="text-sm font-semibold text-muted-foreground">
          StatusAlert (with & without Action)
        </h3>
        <StatusAlert
          variant="destructive"
          action={
            <Button size="sm" onClick={() => toast.info("Retrying...")}>
              <RotateCcw size={15} aria-hidden="true" />
              {th ? "ลองใหม่" : "Retry"}
            </Button>
          }
        >
          {t.failed}
        </StatusAlert>
        <StatusAlert variant="warning">
          {th
            ? "เซนเซอร์ตู้เย็นไม่ได้ส่งข้อมูลนานกว่า 15 นาที"
            : "Fridge sensor has not reported for over 15 minutes."}
        </StatusAlert>
        <StatusAlert variant="success">
          {th
            ? "เชื่อมต่อ LINE และบันทึกการตั้งค่าเรียบร้อย"
            : "LINE connected and settings saved."}
        </StatusAlert>
      </div>

      <div className="grid gap-3 pt-2">
        <h3 className="text-sm font-semibold text-muted-foreground">
          Sonner Toasts (Interactive Triggers)
        </h3>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="lime"
            onClick={() =>
              toast.success(th ? "เพิ่มรายการอาหารแล้ว" : "Food item added")
            }
          >
            Success Toast
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => toast.info(th ? "กำลังซิงค์ข้อมูล" : "Syncing telemetry")}
          >
            Info Toast
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              toast.warning(th ? "ประตูเปิดค้างอยู่" : "Door left open")
            }
          >
            Warning Toast
          </Button>
          <Button
            size="sm"
            variant="dangerGhost"
            onClick={() => toast.error(th ? "บันทึกไม่สำเร็จ" : "Failed to save")}
          >
            Error Toast
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() =>
              toast(th ? "นำนมสดออกจากตู้เย็นแล้ว" : "Removed Milk", {
                description: th ? "กดเลิกทำเพื่อกู้คืน" : "Click undo to restore",
                action: {
                  label: th ? "เลิกทำ" : "Undo",
                  onClick: () => toast.success(th ? "กู้คืนแล้ว" : "Restored"),
                },
              })
            }
          >
            Action Toast
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

function GalleryOverlays({
  language,
  confirmResult,
  triggerConfirm,
}: {
  language: Language;
  confirmResult: string;
  triggerConfirm: GalleryConfirm;
}) {
  const th = language === "th";
  const t = words[language];
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <SectionCard
      id="overlays"
      title={
        th
          ? "3. หน้าต่างโต้ตอบ (Dialog, Sheet, AlertDialog & useConfirm)"
          : "3. Overlays & Confirmations"
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <Dialog>
          <DialogTrigger render={<Button variant="primary" />}>
            Open Dialog
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {th ? "รายละเอียดตู้เย็น" : "Fridge Details"}
              </DialogTitle>
              <DialogDescription>
                {th
                  ? "ตัวอย่าง Dialog มาตรฐานพร้อมปุ่มปิดและโฟกัสอัตโนมัติ"
                  : "Standard Base UI Dialog with close button and focus management."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter showCloseButton>
              <DialogClose render={<Button variant="primary" />}>
                {th ? "ตกลง" : "Save"}
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Button variant="secondary" onClick={() => setSheetOpen(true)}>
          Open Sheet Wrapper
        </Button>
        <Sheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title={th ? "แก้ไขรายการ (Sheet)" : "Edit Item (Sheet)"}
        >
          <p className="sub">
            {th
              ? "ตัวอย่างคอมโพเนนต์ Sheet ที่ครอบ DialogContent"
              : "FoodWarden Sheet wrapper around DialogContent."}
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setSheetOpen(false)}>
              {t.cancel}
            </Button>
            <Button variant="primary" onClick={() => setSheetOpen(false)}>
              <Check size={16} aria-hidden="true" />
              {th ? "บันทึก" : "Save"}
            </Button>
          </div>
        </Sheet>

        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="dangerGhost" />}>
            Open AlertDialog
          </AlertDialogTrigger>
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogMedia>
                <AlertTriangle aria-hidden="true" />
              </AlertDialogMedia>
              <AlertDialogTitle>
                {th ? "หยุดการทำงานประตู?" : "Abort door closing?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {th
                  ? "มอเตอร์ประตูจะหยุดทันทีและถอยกลับสู่ตำแหน่งปลอดภัย"
                  : "The door motor will stop immediately and retract to safe home."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
              <AlertDialogAction variant="destructive">
                {th ? "หยุดฉุกเฉิน" : "Emergency Stop"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Button variant="take" onClick={() => void triggerConfirm("take")}>
          useConfirm (take)
        </Button>
        <Button
          variant="destructive"
          onClick={() => void triggerConfirm("destructive")}
        >
          useConfirm (destructive)
        </Button>
        <span className="small">
          {th ? "ผลลัพธ์ล่าสุด: " : "Last confirm: "}
          <strong>{confirmResult}</strong>
        </span>
      </div>
    </SectionCard>
  );
}

function GalleryControls({
  language,
  colorTheme,
  onLanguageChange,
  onColorThemeChange,
}: {
  language: Language;
  colorTheme: ColorTheme;
  onLanguageChange: (next: Language) => void;
  onColorThemeChange: (next: ColorTheme) => void;
}) {
  const th = language === "th";
  const [selectValue, setSelectValue] = useState<string | null>("dairy");
  const categories = th
    ? { dairy: "นมและไข่", produce: "ผักและผลไม้", meat: "เนื้อสัตว์" }
    : { dairy: "Dairy", produce: "Produce", meat: "Meat" };
  const periods = th
    ? { "1h": "1 ชั่วโมง", "24h": "24 ชั่วโมง" }
    : { "1h": "1 hour", "24h": "24 hours" };
  return (
    <SectionCard
      id="controls"
      title={
        th
          ? "4. ตัวควบคุม (Tabs, Select & ThemeLanguagePicker)"
          : "4. Tabs, Select & Preferences"
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="grid min-w-0 grid-cols-1 gap-4 rounded-2xl bg-[var(--bg)] p-4">
          <h3 className="text-sm font-semibold text-muted-foreground">
            Tabs (Horizontal, Line, Vertical & Disabled)
          </h3>
          <Tabs defaultValue="inventory">
            <TabsList className="max-w-full flex-wrap">
              <TabsTrigger value="inventory">
                {th ? "ในตู้เย็น" : "Inventory"}
              </TabsTrigger>
              <TabsTrigger value="devices">
                {th ? "อุปกรณ์" : "Devices"}
              </TabsTrigger>
              <TabsTrigger value="disabled" disabled>
                {th ? "ปิดใช้งาน" : "Disabled"}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="inventory" className="pt-1">
              <p className="sub">
                {th
                  ? "เนื้อหาแท็บรายการอาหาร (อยู่ใต้ TabsList)"
                  : "Inventory tab panel stacked cleanly below TabsList."}
              </p>
            </TabsContent>
            <TabsContent value="devices" className="pt-1">
              <p className="sub">
                {th ? "เนื้อหาแท็บสถานะอุปกรณ์" : "Devices tab panel content."}
              </p>
            </TabsContent>
          </Tabs>

          <Tabs defaultValue="a">
            <TabsList variant="line">
              <TabsTrigger value="a">Line Tab A</TabsTrigger>
              <TabsTrigger value="b">Line Tab B</TabsTrigger>
            </TabsList>
            <TabsContent value="a" className="pt-1">
              <p className="small">Line variant active panel A</p>
            </TabsContent>
            <TabsContent value="b" className="pt-1">
              <p className="small">Line variant active panel B</p>
            </TabsContent>
          </Tabs>

          <Tabs defaultValue="v1" orientation="vertical">
            <TabsList>
              <TabsTrigger value="v1">Vertical 1</TabsTrigger>
              <TabsTrigger value="v2">Vertical 2</TabsTrigger>
            </TabsList>
            <TabsContent value="v1" className="pl-2">
              <p className="small">Vertical tab content 1</p>
            </TabsContent>
            <TabsContent value="v2" className="pl-2">
              <p className="small">Vertical tab content 2</p>
            </TabsContent>
          </Tabs>
        </div>

        <div className="grid content-start gap-3 rounded-2xl bg-[var(--bg)] p-4">
          <h3 className="text-sm font-semibold text-muted-foreground">
            Select (default, sm, disabled, aria-invalid)
          </h3>
          <div className="flex flex-wrap items-center gap-3">
            <Select
              items={categories}
              value={selectValue}
              onValueChange={setSelectValue}
            >
              <SelectTrigger aria-label={th ? "เลือกหมวดหมู่" : "Category select"}>
                <SelectValue
                  placeholder={th ? "เลือกหมวดหมู่" : "Choose category"}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>{th ? "หมวดหมู่" : "Categories"}</SelectLabel>
                  {(
                    [
                      ["dairy", "🥛"],
                      ["produce", "🥬"],
                      ["meat", "🥩"],
                    ] as const
                  ).map(([value, emoji]) => (
                    <SelectItem
                      key={value}
                      value={value}
                      label={categories[value]}
                      disabled={value === "meat"}
                    >
                      <span className="inline-flex items-center gap-2">
                        <span aria-hidden="true" className="shrink-0">
                          {emoji}
                        </span>
                        <span>{categories[value]}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>

            <Select items={periods} defaultValue="1h">
              <SelectTrigger size="sm" aria-label="Small select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1h">{periods["1h"]}</SelectItem>
                <SelectItem value="24h">{periods["24h"]}</SelectItem>
              </SelectContent>
            </Select>

            <Select
              items={{ locked: th ? "ปิดใช้งาน" : "Unavailable" }}
              defaultValue="locked"
              disabled
            >
              <SelectTrigger aria-label="Disabled select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="locked">
                  {th ? "ปิดใช้งาน" : "Unavailable"}
                </SelectItem>
              </SelectContent>
            </Select>

            <Select>
              <SelectTrigger aria-invalid="true" aria-label="Invalid select">
                <SelectValue placeholder="Invalid state" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ok">Option</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <ThemeLanguagePicker
        language={language}
        colorTheme={colorTheme}
        onLanguageChange={onLanguageChange}
        onColorThemeChange={onColorThemeChange}
      />
    </SectionCard>
  );
}

function GallerySwitches({ th }: { th: boolean }) {
  const [switchChecked, setSwitchChecked] = useState(true);
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <Label className="min-h-11 cursor-pointer">
        <Switch
          aria-label={th ? "สวิตช์หลัก" : "Main switch"}
          checked={switchChecked}
          onCheckedChange={(checked) => setSwitchChecked(Boolean(checked))}
        />
        <span aria-hidden="true">
          {switchChecked ? (th ? "เปิด" : "On") : th ? "ปิด" : "Off"}
        </span>
      </Label>
      <Label className="min-h-11 cursor-pointer">
        <Switch size="sm" />
        <span>{th ? "ขนาดเล็ก" : "Small switch"}</span>
      </Label>
      <Label className="min-h-11 text-muted-foreground">
        <Switch defaultChecked disabled />
        <span>{th ? "เปิดอยู่ · ปิดใช้งาน" : "On · Disabled"}</span>
      </Label>
      <Label className="min-h-11 text-muted-foreground">
        <Switch disabled />
        <span>{th ? "ปิดอยู่ · ปิดใช้งาน" : "Off · Disabled"}</span>
      </Label>
    </div>
  );
}

function GalleryForm({ th }: { th: boolean }) {
  const [checkboxChecked, setCheckboxChecked] = useState(true);
  return (
    <SectionCard
      id="form-primitives"
      title={
        th
          ? "4.5 Form & Layout Primitives (Input, Label, Checkbox, Switch, Badge, Card, Separator, Skeleton)"
          : "4.5 Form & Layout Primitives (shadcn Vega)"
      }
      subtitle={
        th
          ? "ชุด shadcn/ui components ที่เพิ่มเข้ามาใหม่ครบทุกสถานะ (default, checked, disabled, invalid, loading)"
          : "shadcn/ui primitives with default, checked, disabled, invalid, and loading states."
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="grid content-start gap-3 rounded-2xl bg-[var(--bg)] p-4">
          <h3 className="text-sm font-semibold text-muted-foreground">
            Input & Label States
          </h3>
          <div className="grid gap-1.5">
            <Label htmlFor="demo-food-name">
              {th ? "ชื่ออาหาร (ปกติ)" : "Food name (Default)"}
            </Label>
            <Input
              id="demo-food-name"
              defaultValue={th ? "นมสดพาสเจอร์ไรส์" : "Pasteurized Milk"}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="demo-search">Search</Label>
              <Input id="demo-search" type="search" placeholder="Milk…" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="demo-time">Time</Label>
              <Input id="demo-time" type="time" defaultValue="07:30" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="demo-date">Date</Label>
              <Input id="demo-date" type="date" defaultValue="2026-11-23" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="demo-disabled">Disabled</Label>
              <Input id="demo-disabled" disabled defaultValue="Locked value" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="demo-invalid">
              {th
                ? "ข้อมูลไม่ถูกต้อง (aria-invalid)"
                : "Invalid input (aria-invalid)"}
            </Label>
            <Input
              id="demo-invalid"
              aria-invalid="true"
              defaultValue="Bad value"
            />
          </div>
        </div>

        <div className="grid content-start gap-4 rounded-2xl bg-[var(--bg)] p-4">
          <div className="grid gap-2.5">
            <h3 className="text-sm font-semibold text-muted-foreground">
              Checkbox & Switch States (Base UI)
            </h3>
            <div className="flex flex-wrap items-center gap-4">
              <Label className="cursor-pointer">
                <Checkbox
                  checked={checkboxChecked}
                  onCheckedChange={(checked) =>
                    setCheckboxChecked(Boolean(checked))
                  }
                />
                <span>{checkboxChecked ? "Checked" : "Unchecked"}</span>
              </Label>
              <Label className="cursor-pointer">
                <Checkbox defaultChecked={false} />
                <span>Unchecked</span>
              </Label>
              <Label className="opacity-60">
                <Checkbox defaultChecked disabled />
                <span>Disabled</span>
              </Label>
            </div>
            <Separator />
            <GallerySwitches th={th} />
          </div>

          <Separator />

          <div className="grid gap-2">
            <h3 className="text-sm font-semibold text-muted-foreground">
              Badge Variants
            </h3>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  "default",
                  "secondary",
                  "outline",
                  "destructive",
                  "lime",
                  "fresh",
                  "soon",
                  "expired",
                  "neutral",
                ] as const
              ).map((variant) => (
                <Badge key={variant} variant={variant}>
                  {variant}
                </Badge>
              ))}
            </div>
          </div>

          <Separator />

          <div className="grid gap-3 sm:grid-cols-2">
            <Card size="sm">
              <CardHeader>
                <CardTitle>{th ? "ตัวอย่าง Card" : "Card Example"}</CardTitle>
                <CardDescription>CardHeader + Footer</CardDescription>
                <CardAction>
                  <Badge variant="lime">New</Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                <p className="small">
                  {th ? "เนื้อหาภายในการ์ดมาตรฐาน" : "Standard CardContent slot."}
                </p>
              </CardContent>
              <CardFooter>
                <Button size="xs" variant="primary">
                  Action
                </Button>
              </CardFooter>
            </Card>

            <Card size="sm">
              <CardHeader>
                <CardTitle>Skeleton (Loading)</CardTitle>
                <CardDescription>Placeholder UI</CardDescription>
              </CardHeader>
              <CardContent>
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function GalleryTable({ language, now }: { language: Language; now: number }) {
  const th = language === "th";
  const [state, setState] = useState<"data" | "empty" | "loading">("data");
  useEffect(() => {
    if (state !== "loading") return;
    const timer = window.setTimeout(() => setState("data"), 900);
    return () => window.clearTimeout(timer);
  }, [state]);
  const states = [
    ["data", th ? "มีข้อมูล (Data)" : "Data"],
    ["empty", th ? "ว่าง (Empty)" : "Empty"],
    ["loading", th ? "กำลังโหลด (Loading)" : "Loading"],
  ] as const;
  return (
    <SectionCard
      id="table"
      title={th ? "5. ตาราง (Table) และ ReadingTime" : "5. Table & ReadingTime"}
    >
      <div className="flex flex-wrap gap-4 text-sm">
        <span>
          &lt;60s:{" "}
          <ReadingTime timeS={now - 15} now={now} language={language} />
        </span>
        <span>
          Minutes:{" "}
          <ReadingTime timeS={now - 420} now={now} language={language} />
        </span>
        <span>
          Hours:{" "}
          <ReadingTime timeS={now - 7200} now={now} language={language} />
        </span>
        <span>
          Days:{" "}
          <ReadingTime timeS={now - 172800} now={now} language={language} />
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {states.map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            aria-pressed={state === value}
            variant={state === value ? "primary" : "secondary"}
            onClick={() => setState(value)}
          >
            {label}
          </Button>
        ))}
      </div>

      <Table scrollLabel={th ? "ตารางตัวอย่าง" : "Example table"}>
        <TableCaption>
          {state === "data"
            ? th
              ? "ตัวอย่างตารางแสดงสถานะโหนด"
              : "Example hardware node status table."
            : state === "loading"
              ? th
                ? "กำลังโหลดข้อมูลโหนด"
                : "Loading node status."
              : th
                ? "ยังไม่มีข้อมูลโหนด"
                : "No node data yet."}
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Node</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>State</TableHead>
            <TableHead className="text-right">Latency</TableHead>
          </TableRow>
        </TableHeader>
        {state === "data" ? (
          <>
            <TableBody>
              <TableRow>
                <TableCell className="font-semibold">C0</TableCell>
                <TableCell>Camera & Gateway</TableCell>
                <TableCell>Online</TableCell>
                <TableCell className="text-right">42 ms</TableCell>
              </TableRow>
              <TableRow data-state="selected">
                <TableCell className="font-semibold">F0</TableCell>
                <TableCell>Fridge Sensor (Selected Row)</TableCell>
                <TableCell>Deep Sleep / BLE</TableCell>
                <TableCell className="text-right">118 ms</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-semibold">D0</TableCell>
                <TableCell>Door Closer</TableCell>
                <TableCell>Closed</TableCell>
                <TableCell className="text-right">19 ms</TableCell>
              </TableRow>
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3}>Active Nodes</TableCell>
                <TableCell className="text-right">3 / 3</TableCell>
              </TableRow>
            </TableFooter>
          </>
        ) : state === "loading" ? (
          <TableBody>
            {[0, 1, 2].map((row) => (
              <TableRow key={row}>
                <TableCell>
                  <Skeleton className="h-4 w-10" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-36" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-24" />
                </TableCell>
                <TableCell className="text-right">
                  <Skeleton className="ml-auto h-4 w-12" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        ) : (
          <TableBody>
            <TableRow>
              <TableCell colSpan={4} className="py-8 text-center">
                <p className="font-semibold">
                  {th ? "ยังไม่มีข้อมูลโหนด" : "No nodes yet"}
                </p>
                <p className="small">
                  {th
                    ? "กดโหลดตัวอย่างเพื่อจำลองการเชื่อมต่อเกตเวย์"
                    : "Load the sample to simulate connecting a gateway."}
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-3"
                  onClick={() => setState("loading")}
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  {th ? "โหลดตัวอย่าง" : "Load sample"}
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        )}
      </Table>
    </SectionCard>
  );
}

function GalleryMetrics({
  language,
  now,
  healthyDoor,
  alertDoor,
}: {
  language: Language;
  now: number;
  healthyDoor: DoorEvent[];
  alertDoor: DoorEvent[];
}) {
  const th = language === "th";
  const healthySample: Sample = {
    nodeId: "F0",
    timeS: now - 35,
    temperature: 4.2,
    voc: 85,
    light: 120,
  };
  const alertSample: Sample = {
    nodeId: "F0",
    timeS: now - 900,
    temperature: 11.8,
    voc: 340,
    light: 2450,
  };
  return (
    <SectionCard
      id="metrics"
      title={
        th
          ? "6. Metrics Component — ทุกสถานะ (Healthy, Alert/Stale, Empty, Failed)"
          : "6. Metrics Component States"
      }
    >
      <div className="grid gap-6">
        <div>
          <p className="small pb-2 font-semibold">State: Healthy / Fresh</p>
          <Metrics
            latest={healthySample}
            doorEvents={healthyDoor}
            now={now}
            language={language}
            failed={false}
            fridgeId="demo"
          />
        </div>
        <div>
          <p className="small pb-2 font-semibold">State: Alert & Stale</p>
          <Metrics
            latest={alertSample}
            doorEvents={alertDoor}
            now={now}
            language={language}
            failed={false}
            fridgeId="demo"
          />
        </div>
        <div>
          <p className="small pb-2 font-semibold">State: Empty / Waiting</p>
          <Metrics
            latest={null}
            doorEvents={[]}
            now={now}
            language={language}
            failed={false}
            fridgeId="demo"
          />
        </div>
        <div>
          <p className="small pb-2 font-semibold">State: Failed</p>
          <Metrics
            latest={null}
            doorEvents={[]}
            now={now}
            language={language}
            failed={true}
            fridgeId="demo"
          />
        </div>
      </div>
    </SectionCard>
  );
}

function GalleryDevices({
  language,
  now,
  healthyDoor,
  alertDoor,
}: {
  language: Language;
  now: number;
  healthyDoor: DoorEvent[];
  alertDoor: DoorEvent[];
}) {
  const th = language === "th";
  const [deviceMode, setDeviceMode] = useState<DeviceDemoMode>("degraded");
  const deviceHeartbeats: Record<
    Exclude<DeviceDemoMode, "loading" | "error">,
    Heartbeat | null
  > = {
    healthy: {
      gatewaySeenS: now - 15,
      receivedS: now - 15,
      nodes: [
        { id: "C0", reported: true, reportedS: now - 15, lastKnownS: now - 15 },
        { id: "F0", reported: true, reportedS: now - 40, lastKnownS: now - 40 },
        { id: "D0", reported: true, reportedS: now - 20, lastKnownS: now - 20 },
      ],
    },
    degraded: {
      gatewaySeenS: now - 20,
      receivedS: now - 20,
      nodes: [
        { id: "C0", reported: true, reportedS: now - 20, lastKnownS: now - 20 },
        {
          id: "F0",
          reported: true,
          reportedS: now - 1400,
          lastKnownS: now - 1400,
        },
        {
          id: "D0",
          reported: false,
          reportedS: null,
          lastKnownS: now - 5400,
        },
      ],
    },
    unknown: null,
  };

  return (
    <SectionCard
      id="devices"
      title={
        th
          ? "7. แผนผังอุปกรณ์และสถานะโหนด (Devices & Schematic)"
          : "7. Device Schematic & Health Tiers"
      }
      subtitle={
        th
          ? "ทดสอบสลับทุกสถานะของโหนด C0, F0, D0 (ปกติ, ช้า, ขาดการติดต่อ, รอข้อมูล, กำลังโหลด, ผิดพลาด)"
          : "Interactive state switcher for C0, F0, and D0 health tiers, loading, and error states."
      }
    >
      <ToggleGroup<DeviceDemoMode>
        aria-label={th ? "ตัวอย่างสถานะอุปกรณ์" : "Device state examples"}
        value={[deviceMode]}
        deselectable={false}
        onValueChange={([mode]) => {
          if (mode) setDeviceMode(mode);
        }}
        className="flex flex-wrap gap-1"
      >
        {(
          [
            ["degraded", th ? "พบปัญหาบางอุปกรณ์" : "Some devices need attention"],
            ["healthy", th ? "ปกติทั้งหมด" : "All healthy"],
            ["unknown", th ? "รอข้อมูล" : "Waiting for report"],
            ["loading", th ? "กำลังโหลด" : "Loading"],
            ["error", th ? "โหลดไม่สำเร็จ" : "Load error"],
          ] as const
        ).map(([mode, label]) => (
          <Toggle
            key={mode}
            value={mode}
            className="min-h-9 rounded-md border border-transparent bg-secondary px-3 py-1 text-sm font-semibold text-foreground shadow-none transition-none hover:bg-accent data-pressed:border-ring data-pressed:bg-accent data-pressed:text-foreground pointer-coarse:min-h-11"
          >
            {label}
          </Toggle>
        ))}
      </ToggleGroup>

      <div className="min-w-0">
        <Devices
          headingLevel={3}
          fridgeId="demo"
          heartbeat={
            deviceMode === "loading" || deviceMode === "error"
              ? undefined
              : deviceHeartbeats[deviceMode]
          }
          doorEvents={deviceMode === "degraded" ? alertDoor : healthyDoor}
          error={deviceMode === "error"}
          language={language}
        />
      </div>
    </SectionCard>
  );
}

const GALLERY_CHART_STATES = [
  { value: "loading", th: "กำลังโหลด", en: "Loading" },
  { value: "data", th: "มีข้อมูล", en: "Live data" },
  { value: "partial", th: "ข้อมูลขาดช่วง", en: "Partial data" },
  { value: "empty", th: "ไม่มีข้อมูล (Empty)", en: "Empty" },
  { value: "error", th: "โหลดไม่สำเร็จ (Error)", en: "Error" },
] as const;

const GALLERY_CHART_METRICS = {
  temperature: {
    name: { th: "อุณหภูมิ", en: "Temperature" },
    legend: { th: "อุณหภูมิ", en: "Temperature" },
    threshold: 8,
    unit: "°C",
    color: "var(--leaf)",
  },
  voc: {
    name: { th: "คุณภาพอากาศ", en: "Air quality" },
    legend: { th: "VOC", en: "VOC" },
    threshold: 250,
    unit: "VOC",
    color: "var(--soon)",
  },
} as const;

const GALLERY_CHART_COPY = {
  th: {
    title: "8. กราฟข้อมูลเซนเซอร์ (Recharts Sensor Chart)",
    subtitle: "เลือกสถานะเพื่อทดลองกราฟอุณหภูมิและ VOC",
    retry: "ลองใหม่",
    empty: "เซนเซอร์ไม่ได้ส่งค่านี้ในช่วงที่เลือก",
    threshold: "เส้นประแสดงเกณฑ์แจ้งเตือน",
    prompt: "เลือกสถานะด้านบนเพื่อเริ่มทดลอง",
    partial: "ไม่มีค่าที่เซนเซอร์ส่งในบางช่วง กราฟเว้นช่วงไว้ตามข้อมูลที่ได้รับ",
  },
  en: {
    title: "8. Sensor Chart States",
    subtitle: "Choose a state to try the temperature and VOC charts.",
    retry: "Retry",
    empty: "No values for this metric in the selected period.",
    threshold: "Dashed line shows alert threshold",
    prompt: "Choose a state above to start the preview.",
    partial:
      "Some sensor readings are missing. The chart leaves gaps at those times.",
  },
};

function GalleryCharts({ language }: { language: Language }) {
  const copy = GALLERY_CHART_COPY[language];
  const t = words[language];
  const [chartState, setChartState] = useState<
    (typeof GALLERY_CHART_STATES)[number]["value"] | null
  >(null);
  const [chartMetric, setChartMetric] = useState<"temperature" | "voc">(
    "temperature",
  );
  const metric = GALLERY_CHART_METRICS[chartMetric];
  const hasReadings = chartState === "data" || chartState === "partial";
  const loading = (
    <div className="grid gap-2">
      <output>{t.loading}</output>
      <Skeleton className="h-56 w-full" />
    </div>
  );

  return (
    <SectionCard id="charts" title={copy.title} subtitle={copy.subtitle}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {GALLERY_CHART_STATES.map(({ value, ...label }) => (
            <Button
              key={value}
              size="sm"
              variant={chartState === value ? "primary" : "secondary"}
              aria-pressed={chartState === value}
              onClick={() => setChartState(value)}
            >
              {label[language]}
            </Button>
          ))}
        </div>

        {hasReadings && (
          <div className="flex flex-wrap gap-2">
            {(["temperature", "voc"] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={chartMetric === value ? "lime" : "secondary"}
                aria-pressed={chartMetric === value}
                onClick={() => setChartMetric(value)}
              >
                {GALLERY_CHART_METRICS[value].name[language]} (
                {GALLERY_CHART_METRICS[value].unit})
              </Button>
            ))}
          </div>
        )}
      </div>

      {chartState === null ? (
        <p className="sub">{copy.prompt}</p>
      ) : chartState === "loading" ? (
        loading
      ) : chartState === "error" ? (
        <StatusAlert
          variant="destructive"
          action={
            <Button size="sm" onClick={() => setChartState("data")}>
              <RotateCcw size={15} aria-hidden="true" />
              {copy.retry}
            </Button>
          }
        >
          {t.failed}
        </StatusAlert>
      ) : chartState === "empty" ? (
        <div className="rounded-2xl bg-[var(--bg)] p-6 text-center">
          <p className="sub">{copy.empty}</p>
        </div>
      ) : (
        <div className="grid gap-2 rounded-2xl bg-[var(--bg)] p-4">
          {chartState === "partial" && (
            <StatusAlert variant="warning">{copy.partial}</StatusAlert>
          )}
          <Suspense fallback={loading}>
            <GallerySensorPlot
              metric={chartMetric}
              name={metric.legend[language]}
              threshold={metric.threshold}
              unit={metric.unit}
              color={metric.color}
              partial={chartState === "partial"}
            />
          </Suspense>
          <p className="small">
            {copy.threshold} ({metric.threshold} {metric.unit})
          </p>
        </div>
      )}
    </SectionCard>
  );
}

function GalleryInventoryAndLine({
  language,
  triggerConfirm,
}: {
  language: Language;
  triggerConfirm: GalleryConfirm;
}) {
  const th = language === "th";
  const [favoritesMap, setFavoritesMap] = useState<Record<string, boolean>>({
    milk: true,
    spinach: false,
    shrimp: false,
  });
  const [removed, setRemoved] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const demoFoodItems: DemoInventoryItem[] = [
    {
      id: "milk",
      emoji: "🥛",
      nameTh: "นมสดพาสเจอร์ไรส์",
      nameEn: "Fresh Pasteurized Milk",
      categoryTh: "นมและไข่",
      categoryEn: "Dairy",
      state: "fresh",
      badgeTh: "ยังสด",
      badgeEn: "Fresh",
      expiryTextTh: "อีก 5 วัน · 28 พ.ย.",
      expiryTextEn: "In 5 days · Nov 28",
      qty: 2,
      favorite: Boolean(favoritesMap.milk),
    },
    {
      id: "spinach",
      emoji: "🥬",
      nameTh: "ผักโขมอินทรีย์",
      nameEn: "Organic Spinach",
      categoryTh: "ผักและผลไม้",
      categoryEn: "Produce",
      state: "soon",
      badgeTh: "รีบทาน",
      badgeEn: "Eat soon",
      expiryTextTh: "พรุ่งนี้ · 24 พ.ย.",
      expiryTextEn: "Tomorrow · Nov 24",
      qty: 1,
      favorite: Boolean(favoritesMap.spinach),
    },
    {
      id: "shrimp",
      emoji: "🦐",
      nameTh: "กุ้งต้มสุก",
      nameEn: "Cooked shrimp",
      categoryTh: "อาหารทะเล",
      categoryEn: "Seafood",
      state: "expired",
      badgeTh: "หมดอายุ",
      badgeEn: "Expired",
      expiryTextTh: "หมดอายุ 1 วันที่แล้ว",
      expiryTextEn: "Expired 1 day ago",
      qty: 1,
      favorite: Boolean(favoritesMap.shrimp),
      busy: true,
    },
  ];
  const visibleFood = demoFoodItems.filter(
    (item) => !removed.includes(item.id),
  );

  async function takeOut(item: DemoInventoryItem) {
    if (await triggerConfirm("take")) {
      setRemoved((previous) => [...previous, item.id]);
      document.getElementById("inventory-qr")?.focus({ preventScroll: true });
    }
  }

  return (
    <SectionCard
      id="inventory-qr"
      title={
        th
          ? "9. การ์ดรายการอาหาร, Favorite Star และ LINE QR Pairing"
          : "9. Inventory Cards, Favorite Star & LINE QR"
      }
      subtitle={
        th
          ? "ตัวอย่าง Inventory Item Rows (fresh, soon, expired) พร้อมปุ่มดาว Favorite (active/inactive/busy) และ QR เชื่อมต่อ LINE"
          : "Sample Inventory rows (fresh, soon, expired), interactive Favorite star states, and LINE Pairing QR states."
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="grid content-start gap-3">
          <h3 className="text-sm font-semibold text-muted-foreground">
            Inventory Rows & FavoriteToggle States
          </h3>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <output className="small">
              {th
                ? `เหลือ ${visibleFood.length} รายการ`
                : `${visibleFood.length} items remaining`}
            </output>
            <Button
              size="sm"
              onClick={() => {
                setRemoved([]);
                setQuantities({});
                setFavoritesMap({ milk: true, spinach: false, shrimp: false });
              }}
            >
              {th ? "คืนค่าตัวอย่าง" : "Reset inventory"}
            </Button>
          </div>
          <div className="min-w-0">
            {visibleFood.length === 0 ? (
              <p className="sub">
                {th ? "ไม่มีอาหารในตัวอย่างแล้ว" : "The sample inventory is empty."}
              </p>
            ) : (
              <ul className="@container divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                {visibleFood.map((item) => (
                  <GalleryInventoryRow
                    key={item.id}
                    item={{ ...item, qty: quantities[item.id] ?? item.qty }}
                    th={th}
                    onTakeOut={() => void takeOut(item)}
                    onSaveQuantity={(quantity) =>
                      setQuantities((previous) => ({
                        ...previous,
                        [item.id]: quantity,
                      }))
                    }
                    onFavoriteToggle={() => {
                      setFavoritesMap((previous) => ({
                        ...previous,
                        [item.id]: !previous[item.id],
                      }));
                      const messages = th
                        ? {
                            removed: "นำออกจากของโปรดแล้ว",
                            added: "เพิ่มในของโปรดแล้ว",
                          }
                        : {
                            removed: "Removed from favorites",
                            added: "Added to favorites",
                          };
                      toast.success(
                        item.favorite ? messages.removed : messages.added,
                      );
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        <GalleryLinePairing th={th} />
      </div>
    </SectionCard>
  );
}

const GALLERY_LINE_COPY = {
  th: {
    waiting: "กำลังรอจับคู่ (QR)",
    connected: "เชื่อมต่อแล้ว",
    title: "การแจ้งเตือนผ่าน LINE",
    sent: "ส่งข้อความทดสอบแล้ว",
    send: "ส่งข้อความทดสอบ",
    disconnect: "ตัดการเชื่อมต่อ",
    scan: "สแกนเพื่อเชื่อมต่อ LINE",
    copied: "คัดลอกรหัสแล้ว",
    copy: "คัดลอก",
    expiry: "รหัสหมดอายุใน 04:58",
    notConnected: "ยังไม่เชื่อมต่อ",
  },
  en: {
    waiting: "Pairing QR",
    connected: "Connected",
    title: "LINE Notifications",
    sent: "Test sent",
    send: "Send test",
    disconnect: "Disconnect",
    scan: "Scan to pair LINE",
    copied: "Code copied",
    copy: "Copy",
    expiry: "Code expires in 04:58",
    notConnected: "Not connected",
  },
};

function GalleryLinePairing({ th }: { th: boolean }) {
  const copy = GALLERY_LINE_COPY[th ? "th" : "en"];
  const [pairing, setPairing] = useState<"waiting" | "expired" | "linked">(
    "waiting",
  );
  const lineLinked = pairing === "linked";
  const pairingCode = "PAIR-849201";
  const [copied, setCopied] = useState<"success" | "error" | null>(null);

  function changePairing(next: typeof pairing) {
    setPairing(next);
    setCopied(null);
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(pairingCode);
      setCopied("success");
    } catch {
      setCopied("error");
    }
  }
  return (
    <div className="grid content-start gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-muted-foreground">
          LINE Pairing QR & Connection States
        </h3>
        <div className="flex flex-wrap gap-2">
          <Button
            size="xs"
            variant={pairing === "waiting" ? "primary" : "secondary"}
            aria-pressed={pairing === "waiting"}
            onClick={() => changePairing("waiting")}
          >
            {copy.waiting}
          </Button>
          <Button
            size="xs"
            variant={lineLinked ? "lime" : "secondary"}
            aria-pressed={lineLinked}
            onClick={() => changePairing("linked")}
          >
            {copy.connected}
          </Button>
          <Button
            size="xs"
            variant={pairing === "expired" ? "primary" : "secondary"}
            aria-pressed={pairing === "expired"}
            onClick={() => changePairing("expired")}
          >
            {th ? "รหัสหมดอายุ" : "Expired code"}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 rounded-2xl bg-[var(--bg)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="conn-ic line" aria-hidden="true">
              <MessageCircle size={20} />
            </span>
            <strong>{copy.title}</strong>
          </div>
          <span className={`pill ${lineLinked ? "fresh" : "neutral"}`}>
            {lineLinked ? (
              <>
                <Check size={14} aria-hidden="true" />
                {copy.connected}
              </>
            ) : (
              copy.notConnected
            )}
          </span>
        </div>

        {lineLinked ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => toast.success(copy.sent)}
            >
              <Send size={16} aria-hidden="true" />
              {copy.send}
            </Button>
            <Button
              size="sm"
              variant="dangerGhost"
              onClick={() => changePairing("waiting")}
            >
              <Unplug size={16} aria-hidden="true" />
              {copy.disconnect}
            </Button>
          </div>
        ) : pairing === "expired" ? (
          <StatusAlert
            variant="warning"
            action={
              <Button size="sm" onClick={() => changePairing("waiting")}>
                {th ? "สร้างรหัสใหม่" : "Generate another code"}
              </Button>
            }
          >
            {th ? "รหัสตัวอย่างหมดอายุแล้ว" : "The sample pairing code has expired."}
          </StatusAlert>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <div className="rounded-xl bg-white p-2">
              <QRCodeSVG
                value={`FoodWarden demo: ${pairingCode}`}
                size={120}
                marginSize={2}
                title={copy.scan}
              />
            </div>
            <div className="grid gap-2">
              <div className="pairing-code">
                <code>{pairingCode}</code>
                <Button size="sm" onClick={() => void copyCode()}>
                  <Copy size={14} aria-hidden="true" />
                  {copy.copy}
                </Button>
              </div>
              <p className="small">{copy.expiry}</p>
              <output className="small">
                {copied === "success" && copy.copied}
                {copied === "error" &&
                  (th
                    ? "คัดลอกไม่ได้ เลือกข้อความรหัสแล้วคัดลอกได้"
                    : "Clipboard unavailable. Select the code to copy it.")}
              </output>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GalleryInventoryRow({
  item,
  th,
  onTakeOut,
  onSaveQuantity,
  onFavoriteToggle,
}: {
  item: DemoInventoryItem;
  th: boolean;
  onTakeOut: () => void;
  onSaveQuantity: (quantity: number) => void;
  onFavoriteToggle: () => void;
}) {
  const name = th ? item.nameTh : item.nameEn;
  return (
    <InventoryRow
      name={name}
      category={th ? item.categoryTh : item.categoryEn}
      emoji={item.emoji}
      quantity={item.qty}
      status={item.state}
      statusLabel={th ? item.badgeTh : item.badgeEn}
      expiry={th ? item.expiryTextTh : item.expiryTextEn}
      actions={
        <>
          <FavoriteStar
            name={name}
            language={th ? "th" : "en"}
            pressed={item.favorite}
            busy={item.busy}
            onToggle={onFavoriteToggle}
          />
          <GalleryQuantityDialog
            th={th}
            name={name}
            quantity={item.qty}
            onSave={onSaveQuantity}
          />
          <Button
            variant="ghost"
            size="icon"
            className="pointer-coarse:size-11"
            aria-label={th ? `หยิบออก ${name}` : `Take out ${name}`}
            onClick={onTakeOut}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </>
      }
    />
  );
}

function GalleryQuantityDialog({
  th,
  name,
  quantity,
  onSave,
}: {
  th: boolean;
  name: string;
  quantity: number;
  onSave: (quantity: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(quantity));
  const id = useId();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(String(quantity));
        setOpen(next);
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="pointer-coarse:size-11"
            aria-label={th ? `แก้ไข ${name}` : `Edit ${name}`}
          />
        }
      >
        <Pencil size={18} aria-hidden="true" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{th ? "แก้ไขจำนวน" : "Edit quantity"}</DialogTitle>
          <DialogDescription>{name}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const value = Number(draft);
            if (!Number.isInteger(value) || value < 1 || value > 99) return;
            onSave(value);
            setOpen(false);
          }}
        >
          <Label htmlFor={id}>{th ? "จำนวน (1–99)" : "Quantity (1–99)"}</Label>
          <Input
            id={id}
            type="number"
            inputMode="numeric"
            min={1}
            max={99}
            required
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <DialogFooter showCloseButton>
            <Button type="submit" variant="primary">
              {th ? "บันทึก" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GalleryTheme({
  language,
  colorTheme,
}: {
  language: Language;
  colorTheme: ColorTheme;
}) {
  const th = language === "th";
  const t = words[language];
  return (
    <SectionCard
      id="domain"
      title={
        th
          ? "10. Domain States (Food Freshness, Door Events & Theme Tokens)"
          : "10. Domain Badges & Statuses"
      }
    >
      <div className="grid grid-cols-1 gap-4">
        <div>
          <h3 className="pb-2 text-sm font-semibold text-muted-foreground">
            Food Freshness States
          </h3>
          <div className="flex flex-wrap gap-2">
            <span className="pill fresh">{th ? "ยังสด (fresh)" : "Fresh"}</span>
            <span className="pill soon">
              {th ? "รีบทาน (soon)" : "Eat soon"}
            </span>
            <span className="pill expired">
              {th ? "หมดอายุ (expired)" : "Expired"}
            </span>
            <span className="pill neutral">
              {th ? "ไม่ระบุ (unknown)" : "Unknown"}
            </span>
          </div>
        </div>

        <div>
          <h3 className="pb-2 text-sm font-semibold text-muted-foreground">
            Door Event Statuses (Node D0)
          </h3>
          <div className="flex flex-wrap gap-2">
            {DOOR_STATUSES.map((status) => (
              <span
                key={status}
                className="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-sm font-medium"
              >
                <Bell size={14} aria-hidden="true" />
                <span className="wrap-anywhere">{status}:</span>
                <strong>{t[`door_${status}`]}</strong>
              </span>
            ))}
          </div>
        </div>

        <div>
          <h3 className="pb-2 text-sm font-semibold text-muted-foreground">
            Color Palette Tokens ({colorTheme})
          </h3>
          <div className="flex flex-wrap gap-2">
            {COLOR_THEMES.map((theme) => (
              <div
                key={theme}
                className="flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-sm"
              >
                <Palette size={14} aria-hidden="true" />
                <span
                  className="size-4 rounded-full border border-black/10"
                  style={{ backgroundColor: THEME_META[theme].swatch }}
                />
                <span>{th ? THEME_META[theme].th : THEME_META[theme].en}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function GallerySignIn({ language }: { language: Language }) {
  const th = language === "th";
  const [demo, setDemo] = useState<
    "both" | "google" | "local" | "busy" | "setup"
  >("both");
  const choices = [
    ["both", th ? "Google และทดสอบในเครื่อง" : "Google and local"],
    ["google", th ? "Google เท่านั้น" : "Google only"],
    ["local", th ? "ทดสอบในเครื่องเท่านั้น" : "Local only"],
    ["busy", th ? "กำลังเข้าสู่ระบบ" : "Signing in"],
    ["setup", th ? "ยังไม่ได้ตั้งค่า" : "Setup required"],
  ] as const;
  return (
    <SectionCard
      id="signin"
      title={
        th
          ? "11. SignInPanel States (Google+Dev, Dev-only, Signing In, Setup)"
          : "11. SignInPanel States"
      }
    >
      <div className="flex flex-wrap gap-2">
        {choices.map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            aria-pressed={demo === value}
            variant={demo === value ? "primary" : "secondary"}
            onClick={() => setDemo(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      <SignInPanel
        embedded
        config={{
          googleEnabled: demo !== "local" && demo !== "setup",
          devLoginEnabled: demo !== "google" && demo !== "setup",
        }}
        language={language}
        signingIn={demo === "busy"}
        onGoogle={async () => {
          setDemo("busy");
        }}
        onDev={async () => {
          setDemo("busy");
        }}
      />
    </SectionCard>
  );
}
