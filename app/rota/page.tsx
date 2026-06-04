"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import dayjs, { Dayjs } from "dayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { MobileTimePicker } from "@mui/x-date-pickers/MobileTimePicker";
import { supabase } from "@/lib/supabase";
import AppNav from "@/app/components/AppNav";

type CompanyKey = "dohpe" | "dlretail";
type ShiftType = "work" | "holiday";

type StaffMember = { id: string; name: string; hourlyRate: number };

type PayrollStaffSettings = {
  holiday_method?: "fixed_weeks" | "accrual_percent";
  holiday_weeks?: number;
  accrual_percent?: number;
  carried_over_hours?: number;
  break_4h_minutes?: number;
  break_6h_minutes?: number;
};

type StaffPayrollRow = {
  id: string;
  name: string;
  is_active?: boolean | null;
  payroll_settings?: PayrollStaffSettings | null;
};

type OpeningTime = {
  open: string;
  close: string;
  closed?: boolean;
};

type Shift = {
  id: string;
  staffId: string;
  type: ShiftType;
  start: string;
  end: string;
  holidayHours: number;
  note?: string;
  saved?: boolean;
};

type CalendarEvent = { id: string; title: string; start: string; end: string };

type GoogleCalendarApiEvent = {
  id: string;
  title?: string;
  summary?: string;
  start: string;
  end: string;
};

type Company = {
  key: CompanyKey;
  name: string;
  telegramGroup: string;
  logoUrl?: string;
};

type WeeklyReport = {
  id: string;
  company: CompanyKey;
  weekId: string;
  companyName: string;
  staffTotals: Record<
    string,
    {
      name: string;
      workHours: number;
      holidayHours: number;
      breakHours?: number;
      workWage: number;
      holidayWage: number;
    }
  >;
  createdAt: string;
};

type RotaData = Record<CompanyKey, Record<string, Record<string, Shift[]>>>;
type DefaultRota = Record<CompanyKey, Record<string, Shift[]>>;
type EditedWeeks = Record<CompanyKey, Record<string, boolean>>;
type CalendarData = Record<string, CalendarEvent[]>;
type OpeningTimes = Record<CompanyKey, OpeningTime[]>;
type ClosedDays = Record<CompanyKey, Record<string, boolean>>;

type ActiveEditor = {
  company: CompanyKey;
  weekId: string;
  dayIndex: number;
  shiftId: string;
  isNew: boolean;
};

type ExpandedDay = {
  company: CompanyKey;
  weekId: string;
  dayIndex: number;
};

type TimePickerFieldHandle = {
  openPicker: () => void;
};

const ROTA_SETTINGS_TABLE = "rota_settings";
const ROTA_USER_KEY_FALLBACK = "rota:default";
const LEGACY_ROTA_GLOBAL_KEY = "dohpe_global_rota";
const LOCAL_ROTA_KEY = "dohpe_rota_global_settings_v1";
const LOCAL_CALENDAR_KEY = "dohpe_rota_calendar_settings_v1";

const defaultCompanies: Company[] = [
  {
    key: "dohpe",
    name: "Dohpe Vintage",
    telegramGroup: "Dohpe rota group",
    logoUrl: "",
  },
  {
    key: "dlretail",
    name: "DL Retail",
    telegramGroup: "DL Retail rota group",
    logoUrl: "",
  },
];

const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const defaultStaff: StaffMember[] = [
  { id: "staff-1", name: "Dave", hourlyRate: 12.21 },
  { id: "staff-2", name: "Staff 1", hourlyRate: 12.21 },
  { id: "staff-3", name: "Staff 2", hourlyRate: 12.21 },
  { id: "staff-4", name: "Staff 3", hourlyRate: 12.21 },
];

const defaultOpeningTimes: OpeningTimes = {
  dohpe: [
    { open: "10:00", close: "17:00" },
    { open: "10:00", close: "17:00" },
    { open: "10:00", close: "17:00" },
    { open: "10:00", close: "17:00" },
    { open: "10:00", close: "17:00" },
    { open: "10:00", close: "17:00" },
    { open: "10:00", close: "16:00" },
  ],
  dlretail: [
    { open: "10:00", close: "17:00" },
    { open: "10:00", close: "17:00" },
    { open: "10:00", close: "17:00" },
    { open: "10:00", close: "17:00" },
    { open: "10:00", close: "17:00" },
    { open: "10:00", close: "17:00" },
    { open: "10:00", close: "16:00" },
  ],
};

const defaultPayrollStaffSettings: Required<PayrollStaffSettings> = {
  holiday_method: "fixed_weeks",
  holiday_weeks: 5.6,
  accrual_percent: 12.07,
  carried_over_hours: 0,
  break_4h_minutes: 15,
  break_6h_minutes: 30,
};

function normaliseStaffName(value: string) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function staffFromStaffUsers(
  staffRows: StaffPayrollRow[],
  existingStaff: StaffMember[],
): StaffMember[] {
  const existingById = new Map(existingStaff.map((person) => [person.id, person]));
  const existingByName = new Map(
    existingStaff.map((person) => [normaliseStaffName(person.name), person]),
  );

  return staffRows
    .filter((row) => row.is_active !== false)
    .map((row) => {
      const existing =
        existingById.get(row.id) || existingByName.get(normaliseStaffName(row.name));

      return {
        id: row.id,
        name: row.name,
        hourlyRate: Number(existing?.hourlyRate || 12.21),
      };
    });
}

function staffIdMapFromNames(
  existingStaff: StaffMember[],
  staffRows: StaffPayrollRow[],
) {
  const activeStaffByName = new Map(
    staffRows
      .filter((row) => row.is_active !== false)
      .map((row) => [normaliseStaffName(row.name), row.id]),
  );
  const idMap: Record<string, string> = {};

  for (const person of existingStaff) {
    const replacementId = activeStaffByName.get(normaliseStaffName(person.name));
    if (replacementId && replacementId !== person.id) idMap[person.id] = replacementId;
  }

  return idMap;
}

function remapShiftStaffIds<T>(source: T, staffIdMap: Record<string, string>): T {
  if (Object.keys(staffIdMap).length === 0) return source;

  return JSON.parse(
    JSON.stringify(source),
    (key, value) => (key === "staffId" && staffIdMap[value] ? staffIdMap[value] : value),
  );
}

function normalisePayrollStaffSettings(
  settings?: PayrollStaffSettings | null,
): Required<PayrollStaffSettings> {
  return {
    ...defaultPayrollStaffSettings,
    ...(settings || {}),
    holiday_method:
      settings?.holiday_method === "accrual_percent"
        ? "accrual_percent"
        : "fixed_weeks",
    holiday_weeks: Number(
      settings?.holiday_weeks ?? defaultPayrollStaffSettings.holiday_weeks,
    ),
    accrual_percent: Number(
      settings?.accrual_percent ?? defaultPayrollStaffSettings.accrual_percent,
    ),
    carried_over_hours: Number(settings?.carried_over_hours ?? 0),
    break_4h_minutes: Number(
      settings?.break_4h_minutes ??
        defaultPayrollStaffSettings.break_4h_minutes,
    ),
    break_6h_minutes: Number(
      settings?.break_6h_minutes ??
        defaultPayrollStaffSettings.break_6h_minutes,
    ),
  };
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfWeek(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getOperationalWeekStart(date: Date, openingTimes: OpeningTimes) {
  const weekStart = startOfWeek(date);
  let lastOpenDayIndex = -1;

  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const isOpen = (Object.keys(openingTimes) as CompanyKey[]).some(
      (company) => !openingTimes[company]?.[dayIndex]?.closed,
    );

    if (isOpen) lastOpenDayIndex = dayIndex;
  }

  if (lastOpenDayIndex === -1) return weekStart;

  const latestCloseMinutes = Math.max(
    ...(Object.keys(openingTimes) as CompanyKey[])
      .filter((company) => !openingTimes[company]?.[lastOpenDayIndex]?.closed)
      .map((company) => timeToMinutes(openingTimes[company]?.[lastOpenDayIndex]?.close || "17:00")),
  );
  const closeBoundary = addDays(weekStart, lastOpenDayIndex);

  closeBoundary.setHours(
    Math.floor(latestCloseMinutes / 60),
    latestCloseMinutes % 60,
    0,
    0,
  );

  return date >= closeBoundary ? addWeeks(weekStart, 1) : weekStart;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addWeeks(date: Date, weeks: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + weeks * 7);
  return d;
}

function formatWeekLabel(weekStart: Date) {
  const end = addDays(weekStart, 6);
  return `${weekStart.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  })} – ${end.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  })}`;
}

function timeToMinutes(value: string) {
  if (!value || !value.includes(":")) return 0;
  const [h, m] = value.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

function eventDateKey(value: string) {
  if (!value) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return dateKey(new Date(year, month - 1, day));
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";

  return dateKey(parsed);
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function eventTimeLabel(value: string) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "All day";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";

  return parsed.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function groupGoogleEvents(events: GoogleCalendarApiEvent[]): CalendarData {
  const grouped: CalendarData = {};

  for (const event of events) {
    const startKey = eventDateKey(event.start);
    const endKey = eventDateKey(event.end);

    if (!startKey) continue;

    const isAllDay = /^\d{4}-\d{2}-\d{2}$/.test(event.start);

    if (isAllDay && endKey && endKey !== startKey) {
      let current = parseLocalDate(startKey);
      const exclusiveEnd = parseLocalDate(endKey);

      while (current < exclusiveEnd) {
        const key = dateKey(current);

        if (!grouped[key]) grouped[key] = [];

        grouped[key].push({
          id: event.id,
          title: event.title || event.summary || "Busy",
          start: "All day",
          end: "All day",
        });

        current = addDays(current, 1);
      }
    } else {
      if (!grouped[startKey]) grouped[startKey] = [];

      grouped[startKey].push({
        id: event.id,
        title: event.title || event.summary || "Busy",
        start: eventTimeLabel(event.start),
        end: eventTimeLabel(event.end),
      });
    }
  }

  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => String(a.start).localeCompare(String(b.start)));
  }

  return grouped;
}

function parsePickerTime(value: string) {
  if (!value || !value.includes(":")) return null;
  const parsed = dayjs(`2024-01-01T${value}`);
  return parsed.isValid() ? parsed : null;
}

const TimePickerField = forwardRef<
  TimePickerFieldHandle,
  {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    onAccepted?: () => void;
  }
>(function TimePickerField(
  { value, onChange, disabled = false, onAccepted },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"hours" | "minutes">("hours");
  const [tempValue, setTempValue] = useState<Dayjs | null>(
    parsePickerTime(value),
  );

  function openPicker() {
    if (disabled) return;
    setTempValue(parsePickerTime(value) || dayjs("2024-01-01T09:00"));
    setView("hours");
    setOpen(true);
  }

  useImperativeHandle(ref, () => ({
    openPicker,
  }));

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <MobileTimePicker
        ampm={false}
        open={open}
        view={view}
        views={["hours", "minutes"]}
        openTo="hours"
        closeOnSelect={false}
        minutesStep={5}
        value={tempValue}
        disabled={disabled}
        onOpen={openPicker}
        onClose={() => {
          setOpen(false);
        }}
        onViewChange={(newView) => {
          if (newView === "hours" || newView === "minutes") {
            setView(newView);
          }
        }}
        onChange={(newValue) => {
          if (!newValue || !newValue.isValid()) return;
          setTempValue(newValue);

          if (view === "hours") {
            window.setTimeout(() => setView("minutes"), 0);
          }
        }}
        onAccept={(newValue) => {
          if (!newValue || !newValue.isValid()) return;
          onChange(newValue.format("HH:mm"));
          setOpen(false);

          if (onAccepted) {
            window.setTimeout(() => onAccepted(), 350);
          }
        }}
        slotProps={{
          actionBar: {
            actions: ["cancel", "accept"],
          },
          textField: {
            size: "small",
            fullWidth: true,
            onClick: openPicker,
            sx: {
              "& .MuiInputBase-root": {
                borderRadius: "0.5rem",
                backgroundColor: disabled ? "#f5f5f5" : "white",
                fontSize: "0.75rem",
                fontWeight: 700,
              },
              "& input": {
                padding: "8.5px 8px",
                fontSize: "0.75rem",
                fontWeight: 700,
                cursor: "pointer",
              },
            },
          },
          mobilePaper: {
            sx: {
              borderRadius: "24px",
            },
          },
        }}
      />
    </LocalizationProvider>
  );
});

function rawShiftHours(shift: Shift) {
  if (shift.type === "holiday") return Number(shift.holidayHours || 0);
  const start = timeToMinutes(shift.start);
  const end = timeToMinutes(shift.end);
  if (!start || !end || end <= start) return 0;
  return (end - start) / 60;
}

function shiftBreakHours(
  shift: Shift,
  payrollSettings: Required<PayrollStaffSettings>,
) {
  const raw = rawShiftHours(shift);
  if (shift.type === "holiday") return 0;
  if (raw >= 6) return payrollSettings.break_6h_minutes / 60;
  if (raw > 3) return payrollSettings.break_4h_minutes / 60;
  return 0;
}

function shiftPaidHours(
  shift: Shift,
  payrollSettings: Required<PayrollStaffSettings>,
) {
  return Math.max(0, rawShiftHours(shift) - shiftBreakHours(shift, payrollSettings));
}

function formatHours(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function shiftTimeLabel(shift: Shift, opening?: OpeningTime, closed = false) {
  if (shift.type === "holiday")
    return `HOLIDAY ${formatHours(rawShiftHours(shift))}h`;

  if (
    opening &&
    !closed &&
    shift.start === opening.open &&
    shift.end === opening.close
  ) {
    return `${opening.open}-${opening.close}`;
  }

  return `${shift.start}-${shift.end}`;
}

function telegramShiftTimeLabel(
  shift: Shift,
  opening?: OpeningTime,
  closed = false,
) {
  if (shift.type === "holiday") return `${formatHours(rawShiftHours(shift))}h`;

  if (
    opening &&
    !closed &&
    shift.start === opening.open &&
    shift.end === opening.close
  ) {
    return `${opening.open}-${opening.close}`;
  }

  return `${shift.start}-${shift.end}`;
}

function openingTimeLabel(
  opening: OpeningTime,
  mobileFull = false,
  closed = false,
) {
  if (closed) return "Closed";
  return mobileFull
    ? `${opening.open}-${opening.close}`
    : `${opening.open}-${opening.close}`;
}

function money(value: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(value || 0);
}

function cloneShift(shift: Shift): Shift {
  return { ...shift, id: crypto.randomUUID(), saved: true };
}

function makeWorkShift(): Shift {
  return {
    id: crypto.randomUUID(),
    staffId: "",
    type: "work",
    start: "",
    end: "",
    holidayHours: 0,
    note: "",
    saved: true,
  };
}

function makeHolidayShift(): Shift {
  return {
    id: crypto.randomUUID(),
    staffId: "",
    type: "holiday",
    start: "",
    end: "",
    holidayHours: 7,
    note: "Holiday",
    saved: true,
  };
}

function emptyDefault(): DefaultRota {
  return { dohpe: {}, dlretail: {} };
}

function normaliseShiftForCompare(shift: Shift) {
  return {
    staffId: shift.staffId,
    type: shift.type,
    start: shift.start,
    end: shift.end,
    holidayHours: Number(shift.holidayHours || 0),
    note: shift.note || "",
  };
}

function applyRotaPayload(
  saved: any,
  setters: {
    setCompanies: (value: Company[]) => void;
    setLegacyStaff: (value: StaffMember[]) => void;
    setOpeningTimes: (value: OpeningTimes) => void;
    setRota: (value: RotaData) => void;
    setDefaultRota: (value: DefaultRota) => void;
    setEditedWeeks: (value: EditedWeeks) => void;
    setClosedDays: (value: ClosedDays) => void;
    setWeeklyReports: (value: WeeklyReport[]) => void;
  },
) {
  if (!saved) return;

  if (Array.isArray(saved.companies)) setters.setCompanies(saved.companies);
  if (Array.isArray(saved.staff)) setters.setLegacyStaff(saved.staff);
  if (saved.openingTimes) setters.setOpeningTimes(saved.openingTimes);
  if (saved.rota) setters.setRota(saved.rota);
  if (saved.defaultRota) setters.setDefaultRota(saved.defaultRota);
  if (saved.editedWeeks) setters.setEditedWeeks(saved.editedWeeks);
  if (saved.closedDays) setters.setClosedDays(saved.closedDays);
  if (Array.isArray(saved.weeklyReports))
    setters.setWeeklyReports(saved.weeklyReports);
}

function GoogleCalendarLogo() {
  return (
    <span className="relative flex h-6 w-6 shrink-0 overflow-hidden rounded-md bg-white shadow-sm">
      <span className="absolute left-0 top-0 h-full w-1.5 bg-blue-500" />
      <span className="absolute left-0 top-0 h-1.5 w-full bg-red-500" />
      <span className="absolute right-0 top-0 h-full w-1.5 bg-yellow-400" />
      <span className="absolute bottom-0 left-0 h-1.5 w-full bg-green-500" />
      <span className="absolute inset-[5px] flex items-center justify-center rounded-sm bg-white text-[10px] font-black leading-none text-blue-600">
        31
      </span>
    </span>
  );
}

function CompanyLogo({ company }: { company: Company }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-200 text-[10px] font-black text-neutral-600">
      {company.logoUrl ? (
        <img
          src={company.logoUrl}
          alt={company.name}
          className="h-full w-full object-cover"
        />
      ) : (
        company.name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

export default function RotaPage() {
  const saveTimerRef = useRef<number | null>(null);
  const calendarSaveTimerRef = useRef<number | null>(null);
  const statusTimerRef = useRef<number | null>(null);
  const staffRef = useRef<StaffMember[]>(defaultStaff);

  const [rotaUserKey, setRotaUserKey] = useState(ROTA_USER_KEY_FALLBACK);
  const [companies, setCompanies] = useState<Company[]>(defaultCompanies);
  const [mobileCompany, setMobileCompany] = useState<CompanyKey>("dohpe");
  const [staff, setStaff] = useState<StaffMember[]>(defaultStaff);
  const [openingTimes, setOpeningTimes] =
    useState<OpeningTimes>(defaultOpeningTimes);
  const [today] = useState(() => new Date());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [historyEditWeekId, setHistoryEditWeekId] = useState<string | null>(null);
  const [historyEditDirty, setHistoryEditDirty] = useState(false);
  const [rota, setRota] = useState<RotaData>({ dohpe: {}, dlretail: {} });
  const [defaultRota, setDefaultRota] = useState<DefaultRota>(emptyDefault());
  const [editedWeeks, setEditedWeeks] = useState<EditedWeeks>({
    dohpe: {},
    dlretail: {},
  });
  const [weeklyReports, setWeeklyReports] = useState<WeeklyReport[]>([]);
  const [finalisedWeekIds, setFinalisedWeekIds] = useState<Record<string, boolean>>({});
  const [staffPayrollRows, setStaffPayrollRows] = useState<StaffPayrollRow[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [googleCalendarSynced, setGoogleCalendarSynced] = useState(false);
  const [activeEditor, setActiveEditor] = useState<ActiveEditor | null>(null);
  const [expandedDay, setExpandedDay] = useState<ExpandedDay | null>(null);
  const [draftShift, setDraftShift] = useState<Shift | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [cloudLoaded, setCloudLoaded] = useState(false);
  const [calendarUserKey, setCalendarUserKey] = useState("calendar:default");
  const [calendarLoaded, setCalendarLoaded] = useState(false);
  const [closedDays, setClosedDays] = useState<ClosedDays>({
    dohpe: {},
    dlretail: {},
  });
  const [legacyStaff, setLegacyStaff] = useState<StaffMember[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarData>({});
  const [telegramSentWeeks, setTelegramSentWeeks] = useState<
    Record<string, boolean>
  >({});
  const [telegramSendingWeeks, setTelegramSendingWeeks] = useState<
    Record<string, boolean>
  >({});

  const currentWeekStart = useMemo(
    () => getOperationalWeekStart(today, openingTimes),
    [today, openingTimes],
  );

  const futureWeekStarts = useMemo(
    () => [1, 2, 3, 4].map((offset) => addWeeks(currentWeekStart, offset)),
    [currentWeekStart],
  );
  const previousWeekStart = useMemo(
    () => addWeeks(currentWeekStart, -1),
    [currentWeekStart],
  );

  const mobileCompanyList = companies.filter(
    (company) => company.key === mobileCompany,
  );

  useEffect(() => {
    staffRef.current = staff;
  }, [staff]);

  const filteredReports = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return weeklyReports.slice(0, 20);

    return weeklyReports
      .filter((report) => {
        const staffNames = Object.values(report.staffTotals)
          .map((row) => row.name)
          .join(" ")
          .toLowerCase();

        return (
          report.weekId.toLowerCase().includes(q) ||
          report.companyName.toLowerCase().includes(q) ||
          staffNames.includes(q)
        );
      })
      .slice(0, 20);
  }, [historySearch, weeklyReports]);

  const filteredHistoryWeeks = useMemo(() => {
    const reportById = new Map(weeklyReports.map((report) => [report.id, report]));
    const q = historySearch.trim().toLowerCase();
    const finalisedWeekIdsOnly = Array.from(
      new Set(
        Object.keys(finalisedWeekIds)
          .filter((key) => finalisedWeekIds[key])
          .map((key) => key.replace(/^dohpe-/, "").replace(/^dlretail-/, "")),
      ),
    );
    const visibleWeekIds = q
      ? finalisedWeekIdsOnly.filter((weekId) => {
          const reports = companies
            .map((company) => reportById.get(`${company.key}-${weekId}`))
            .filter(Boolean) as WeeklyReport[];
          const staffNames = reports
            .flatMap((report) => Object.values(report.staffTotals).map((row) => row.name))
            .join(" ")
            .toLowerCase();
          return (
            weekId.toLowerCase().includes(q) ||
            formatWeekLabel(getWeekFromId(weekId)).toLowerCase().includes(q) ||
            staffNames.includes(q)
          );
        })
      : [0, 1, 2, 3].map((offset) => getWeekId(addWeeks(previousWeekStart, -offset)));

    const grouped = new Map<string, Record<CompanyKey, WeeklyReport | undefined>>();

    for (const weekId of visibleWeekIds) {
      const hasAnyFinalisedCompany = companies.some((company) =>
        finalisedWeekIds[`${company.key}-${weekId}`],
      );
      if (!hasAnyFinalisedCompany) continue;

      grouped.set(weekId, {
        dohpe: reportById.get(`dohpe-${weekId}`),
        dlretail: reportById.get(`dlretail-${weekId}`),
      });
    }

    return Array.from(grouped.entries())
      .map(([weekId, reports]) => ({ weekId, reports }))
      .sort((a, b) => b.weekId.localeCompare(a.weekId));
  }, [companies, finalisedWeekIds, historySearch, previousWeekStart, weeklyReports]);

  function showStatus(message: string) {
    setStatusMessage(message);
    if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current);
    statusTimerRef.current = window.setTimeout(
      () => setStatusMessage(""),
      3000,
    );
  }

  useEffect(() => {
    async function loadCloudRota() {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const userId = sessionData.session?.user?.id;

        if (!userId) {
          showStatus("Log in to sync rota settings across devices.");
        }

        const key = userId ? `rota:${userId}` : ROTA_USER_KEY_FALLBACK;
        setRotaUserKey(key);

        const scopedLocalKey = `${LOCAL_ROTA_KEY}:${key}`;
        const local =
          localStorage.getItem(scopedLocalKey) ||
          localStorage.getItem(LOCAL_ROTA_KEY);

        if (local) {
          applyRotaPayload(JSON.parse(local), {
            setCompanies,
            setLegacyStaff,
            setOpeningTimes,
            setRota,
            setDefaultRota,
            setEditedWeeks,
            setClosedDays,
            setWeeklyReports,
          });
        }

        const { data, error } = await supabase
          .from(ROTA_SETTINGS_TABLE)
          .select("data")
          .eq("user_key", key)
          .maybeSingle();

        if (error) throw error;

        let saved = data?.data || null;

        if (!saved && userId) {
          const { data: legacyData, error: legacyError } = await supabase
            .from(ROTA_SETTINGS_TABLE)
            .select("data")
            .eq("user_key", LEGACY_ROTA_GLOBAL_KEY)
            .maybeSingle();

          if (legacyError) throw legacyError;

          if (legacyData?.data) {
            saved = legacyData.data;

            await supabase.from(ROTA_SETTINGS_TABLE).upsert(
              {
                user_key: key,
                data: saved,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "user_key" },
            );
          }
        }

        if (saved) {
          applyRotaPayload(saved, {
            setCompanies,
            setLegacyStaff,
            setOpeningTimes,
            setRota,
            setDefaultRota,
            setEditedWeeks,
            setClosedDays,
            setWeeklyReports,
          });
        }
      } catch (error) {
        console.error("ROTA_CLOUD_LOAD_ERROR", error);
        showStatus("Rota loaded locally. Cloud sync may not be set up yet.");
      } finally {
        setCloudLoaded(true);
      }
    }

    loadCloudRota();
  }, []);

  useEffect(() => {
    async function loadFinalisedWeeks() {
      const { data, error } = await supabase
        .from("rota_week_finalisations")
        .select("company_key, week_id, status")
        .eq("status", "finalised");

      if (error) return;

      setFinalisedWeekIds(
        Object.fromEntries(
          (data || []).map((row: any) => [`${row.company_key}-${row.week_id}`, true]),
        ),
      );
    }

    loadFinalisedWeeks();
  }, []);

  useEffect(() => {
    async function loadStaffPayrollSettings() {
      const { data, error } = await supabase
        .from("staff_users")
        .select("id, name, is_active, payroll_settings")
        .eq("is_active", true);

      if (error) {
        console.error("ROTA_PAYROLL_SETTINGS_LOAD_ERROR", error);
        return;
      }

      const staffRows = (data || []) as StaffPayrollRow[];

      setStaffPayrollRows(staffRows);
    }

    loadStaffPayrollSettings();
  }, []);

  useEffect(() => {
    if (!cloudLoaded || staffPayrollRows.length === 0) return;

    const sourceStaff = legacyStaff.length > 0 ? legacyStaff : staffRef.current;
    const staffIdMap = staffIdMapFromNames(sourceStaff, staffPayrollRows);

    const timer = window.setTimeout(() => {
      setRota((currentRota) => remapShiftStaffIds(currentRota, staffIdMap));
      setDefaultRota((currentDefaultRota) =>
        remapShiftStaffIds(currentDefaultRota, staffIdMap),
      );
      setStaff((currentStaff) =>
        staffFromStaffUsers(
          staffPayrollRows,
          sourceStaff.length > 0 ? sourceStaff : currentStaff,
        ),
      );
    }, 0);

    return () => window.clearTimeout(timer);
  }, [cloudLoaded, staffPayrollRows, legacyStaff]);

  useEffect(() => {
    async function loadUserCalendarSettings() {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const key = `calendar:${sessionData.session?.user?.id || "default"}`;
        setCalendarUserKey(key);

        const local = localStorage.getItem(`${LOCAL_CALENDAR_KEY}:${key}`);
        if (local) {
          const parsed = JSON.parse(local);
          if (parsed.googleCalendarSynced)
            setGoogleCalendarSynced(Boolean(parsed.googleCalendarSynced));
          if (parsed.calendarEvents) setCalendarEvents(parsed.calendarEvents);
        }

        const { data, error } = await supabase
          .from(ROTA_SETTINGS_TABLE)
          .select("data")
          .eq("user_key", key)
          .maybeSingle();

        if (error) throw error;

        const saved = data?.data || {};
        if (saved.googleCalendarSynced)
          setGoogleCalendarSynced(Boolean(saved.googleCalendarSynced));
        if (saved.calendarEvents) setCalendarEvents(saved.calendarEvents);
      } catch (error) {
        console.error("ROTA_CALENDAR_LOAD_ERROR", error);
      } finally {
        setCalendarLoaded(true);
      }
    }

    loadUserCalendarSettings();
  }, []);

  useEffect(() => {
    async function loadLiveGoogleCalendarEvents() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.access_token) return;

        const response = await fetch("/api/rota/google/events", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        if (!response.ok) return;

        const data = await response.json();

        if (Array.isArray(data.events)) {
          setCalendarEvents(groupGoogleEvents(data.events));
          setGoogleCalendarSynced(true);
        }
      } catch (error) {
        console.error("ROTA_LIVE_CALENDAR_LOAD_ERROR", error);
      }
    }

    loadLiveGoogleCalendarEvents();
  }, []);

  useEffect(() => {
    if (!cloudLoaded) return;

    const payload = {
      companies,
      openingTimes,
      rota,
      defaultRota,
      editedWeeks,
      closedDays,
      weeklyReports,
    };

    localStorage.setItem(
      `${LOCAL_ROTA_KEY}:${rotaUserKey}`,
      JSON.stringify(payload),
    );

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);

    saveTimerRef.current = window.setTimeout(async () => {
      try {
        const { error } = await supabase.from(ROTA_SETTINGS_TABLE).upsert(
          {
            user_key: rotaUserKey,
            data: payload,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_key" },
        );

        if (error) throw error;
      } catch (error) {
        console.error("ROTA_CLOUD_SAVE_ERROR", error);
        showStatus(
          "Rota save failed. Check Supabase rota_settings permissions.",
        );
      }
    }, 800);

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [
    cloudLoaded,
    rotaUserKey,
    companies,
    openingTimes,
    rota,
    defaultRota,
    editedWeeks,
    closedDays,
    weeklyReports,
  ]);

  useEffect(() => {
    if (!calendarLoaded) return;

    const payload = {
      googleCalendarSynced,
      calendarEvents,
    };

    localStorage.setItem(
      `${LOCAL_CALENDAR_KEY}:${calendarUserKey}`,
      JSON.stringify(payload),
    );

    if (calendarSaveTimerRef.current)
      window.clearTimeout(calendarSaveTimerRef.current);

    calendarSaveTimerRef.current = window.setTimeout(async () => {
      try {
        const { error } = await supabase.from(ROTA_SETTINGS_TABLE).upsert(
          {
            user_key: calendarUserKey,
            data: payload,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_key" },
        );

        if (error) throw error;
      } catch (error) {
        console.error("ROTA_CALENDAR_SAVE_ERROR", error);
      }
    }, 800);

    return () => {
      if (calendarSaveTimerRef.current)
        window.clearTimeout(calendarSaveTimerRef.current);
    };
  }, [calendarLoaded, calendarUserKey, googleCalendarSynced, calendarEvents]);

  function getDayId(week: Date, dayIndex: number) {
    return dateKey(addDays(week, dayIndex));
  }

  function getWeekId(week: Date) {
    return dateKey(week);
  }

  function getWeekFromId(weekId: string) {
    const [y, m, d] = weekId.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function isCurrentWeek(week: Date) {
    return getWeekId(week) === getWeekId(currentWeekStart);
  }

  function getCompanyName(companyKey: CompanyKey) {
    return (
      companies.find((company) => company.key === companyKey)?.name ||
      companyKey
    );
  }

  function getOpening(company: CompanyKey, dayIndex: number) {
    return (
      openingTimes[company]?.[dayIndex] || { open: "10:00", close: "17:00" }
    );
  }

  function isDayClosed(company: CompanyKey, week: Date, dayIndex: number) {
    const dayId = getDayId(week, dayIndex);
    if (closedDays[company]?.[dayId]) return true;
    return Boolean(getOpening(company, dayIndex).closed);
  }

  function closeSpecificDay(company: CompanyKey, week: Date, dayIndex: number) {
    const dayId = getDayId(week, dayIndex);

    setClosedDays((current) => ({
      ...current,
      [company]: {
        ...current[company],
        [dayId]: true,
      },
    }));

    setActiveEditor(null);
    setDraftShift(null);
    setDraftDirty(false);
    showStatus("Day marked closed.");
  }

  function reopenSpecificDay(
    company: CompanyKey,
    week: Date,
    dayIndex: number,
  ) {
    const dayId = getDayId(week, dayIndex);

    setClosedDays((current) => {
      const next = {
        ...current,
        [company]: {
          ...current[company],
        },
      };

      delete next[company][dayId];
      return next;
    });

    showStatus("Day reopened.");
  }

  function toggleExpandedDay(
    company: CompanyKey,
    week: Date,
    dayIndex: number,
  ) {
    const weekId = getWeekId(week);

    setExpandedDay((current) => {
      if (
        current?.company === company &&
        current.weekId === weekId &&
        current.dayIndex === dayIndex
      ) {
        return null;
      }

      return { company, weekId, dayIndex };
    });
  }

  function updateCompany(companyKey: CompanyKey, patch: Partial<Company>) {
    setCompanies((current) =>
      current.map((company) =>
        company.key === companyKey ? { ...company, ...patch } : company,
      ),
    );
  }

  function updateOpening(
    company: CompanyKey,
    dayIndex: number,
    patch: Partial<OpeningTime>,
  ) {
    setOpeningTimes((current) => ({
      ...current,
      [company]: current[company].map((row, index) =>
        index === dayIndex ? { ...row, ...patch } : row,
      ),
    }));
  }

  function getDayShifts(company: CompanyKey, week: Date, dayIndex: number) {
    const weekId = getWeekId(week);
    const dayId = getDayId(week, dayIndex);
    if (editedWeeks[company]?.[weekId]) return rota[company]?.[weekId]?.[dayId] || [];
    const defaultDay = defaultRota[company]?.[String(dayIndex)] || [];
    return defaultDay.length > 0 ? defaultDay : rota[company]?.[weekId]?.[dayId] || [];
  }

  function getDayShiftsByWeekId(
    company: CompanyKey,
    weekId: string,
    dayIndex: number,
  ) {
    const week = getWeekFromId(weekId);
    const dayId = getDayId(week, dayIndex);
    if (editedWeeks[company]?.[weekId]) return rota[company]?.[weekId]?.[dayId] || [];
    const defaultDay = defaultRota[company]?.[String(dayIndex)] || [];
    return defaultDay.length > 0 ? defaultDay : rota[company]?.[weekId]?.[dayId] || [];
  }

  function weekHasDifferentInfo(
    company: CompanyKey,
    week: Date,
    template: Record<string, Shift[]>,
  ) {
    for (let i = 0; i < 7; i += 1) {
      const currentDay = getDayShifts(company, week, i).map(
        normaliseShiftForCompare,
      );
      const templateDay = (template[String(i)] || []).map(
        normaliseShiftForCompare,
      );

      if (JSON.stringify(currentDay) !== JSON.stringify(templateDay)) {
        if (currentDay.length > 0 || templateDay.length > 0) return true;
      }
    }

    return false;
  }

  function markWeekEdited(company: CompanyKey, week: Date) {
    const weekId = getWeekId(week);

    setEditedWeeks((current) => ({
      ...current,
      [company]: {
        ...current[company],
        [weekId]: true,
      },
    }));
  }

  function setDayShifts(
    company: CompanyKey,
    week: Date,
    dayIndex: number,
    shifts: Shift[],
    markEdited = true,
  ) {
    const weekId = getWeekId(week);
    const dayId = getDayId(week, dayIndex);

    setRota((current) => ({
      ...current,
      [company]: {
        ...current[company],
        [weekId]: {
          ...(current[company]?.[weekId] || {}),
          [dayId]: shifts,
        },
      },
    }));

    if (markEdited) {
      markWeekEdited(company, week);
      if (historyEditWeekId === weekId) setHistoryEditDirty(true);
    }
  }

  function openNewShift(
    company: CompanyKey,
    week: Date,
    dayIndex: number,
    type: ShiftType,
    allowClosed = false,
  ) {
    if (isDayClosed(company, week, dayIndex) && !allowClosed) return;

    const shift = type === "holiday" ? makeHolidayShift() : makeWorkShift();

    setExpandedDay(null);
    setDraftShift(shift);
    setDraftDirty(false);
    setActiveEditor({
      company,
      weekId: getWeekId(week),
      dayIndex,
      shiftId: shift.id,
      isNew: true,
    });
  }

  function openExistingShift(
    company: CompanyKey,
    week: Date,
    dayIndex: number,
    shift: Shift,
  ) {
    setExpandedDay(null);
    setDraftShift({ ...shift });
    setDraftDirty(false);
    setActiveEditor({
      company,
      weekId: getWeekId(week),
      dayIndex,
      shiftId: shift.id,
      isNew: false,
    });
  }

  function requestCloseEditor() {
    if (!activeEditor) return;

    if (draftDirty && draftShift) {
      const save = window.confirm(
        "Save changes to this shift? Press OK to save, or Cancel to discard.",
      );

      if (save) {
        saveDraftShift();
      } else {
        setActiveEditor(null);
        setDraftShift(null);
        setDraftDirty(false);
      }

      return;
    }

    setActiveEditor(null);
    setDraftShift(null);
    setDraftDirty(false);
  }

  function updateDraftShift(patch: Partial<Shift>) {
    setDraftShift((current) => (current ? { ...current, ...patch } : current));
    setDraftDirty(true);
  }

  function saveDraftShift() {
    if (!activeEditor || !draftShift) return;

    if (!draftShift.staffId) {
      showStatus("Select a staff member before saving.");
      return;
    }

    if (draftShift.type === "work" && (!draftShift.start || !draftShift.end)) {
      showStatus("Enter start and finish times before saving.");
      return;
    }

    const week = getWeekFromId(activeEditor.weekId);
    const current = getDayShiftsByWeekId(
      activeEditor.company,
      activeEditor.weekId,
      activeEditor.dayIndex,
    );
    const savedShift = { ...draftShift, saved: true };

    const next = (
      activeEditor.isNew
        ? [...current, savedShift]
        : current.map((shift) =>
            shift.id === activeEditor.shiftId ? savedShift : shift,
          )
    ).sort((a, b) => {
      if (a.type === "holiday" && b.type !== "holiday") return 1;
      if (a.type !== "holiday" && b.type === "holiday") return -1;

      return timeToMinutes(a.start) - timeToMinutes(b.start);
    });

    setDayShifts(activeEditor.company, week, activeEditor.dayIndex, next);
    reopenSpecificDay(activeEditor.company, week, activeEditor.dayIndex);
    saveWeeklyReportSnapshot(activeEditor.company, week);

    setActiveEditor(null);
    setDraftShift(null);
    setDraftDirty(false);
    showStatus("Shift saved.");
  }

  function quickDeleteShift(
    company: CompanyKey,
    week: Date,
    dayIndex: number,
    shiftId: string,
  ) {
    const confirmed = window.confirm("Remove this shift?");
    if (!confirmed) return;

    const current = getDayShifts(company, week, dayIndex);

    setDayShifts(
      company,
      week,
      dayIndex,
      current.filter((shift) => shift.id !== shiftId),
    );

    saveWeeklyReportSnapshot(company, week);
    showStatus("Shift removed.");
  }

  function applyDefaultToWeek(
    company: CompanyKey,
    week: Date,
    template: Record<string, Shift[]>,
  ) {
    const weekId = getWeekId(week);
    const copied: Record<string, Shift[]> = {};

    for (let i = 0; i < 7; i += 1) {
      copied[getDayId(week, i)] = (template[String(i)] || []).map(cloneShift);
    }

    setRota((current) => ({
      ...current,
      [company]: {
        ...current[company],
        [weekId]: copied,
      },
    }));
  }

  function setWeekAsDefault(company: CompanyKey, week: Date) {
    const template: Record<string, Shift[]> = {};

    for (let i = 0; i < 7; i += 1) {
      template[String(i)] = getDayShifts(company, week, i).map(cloneShift);
    }

    const futureWeeks = [1, 2, 3, 4].map((offset) => addWeeks(week, offset));
    const willOverwriteDifferentInfo = futureWeeks.some((futureWeek) =>
      weekHasDifferentInfo(company, futureWeek, template),
    );

    if (willOverwriteDifferentInfo) {
      const confirmed = window.confirm(
        "This default is different to information already entered in upcoming weeks. Setting default will overwrite those weeks. Continue?",
      );

      if (!confirmed) return;
    }

    setDefaultRota((current) => ({ ...current, [company]: template }));

    for (const futureWeek of futureWeeks) {
      applyDefaultToWeek(company, futureWeek, template);
    }

    setEditedWeeks((current) => {
      const next = { ...current, [company]: { ...current[company] } };

      for (const futureWeek of futureWeeks) {
        delete next[company][getWeekId(futureWeek)];
      }

      return next;
    });

    showStatus(
      `${getCompanyName(company)} default rota set and applied to next 4 weeks.`,
    );
  }

  function copyWeekToNext(company: CompanyKey, week: Date) {
    const answer = window.prompt(
      "Copy this week to which week?\nEnter 1 for next week, 2 for 2 weeks ahead, 3 for 3 weeks ahead, or 4 for 4 weeks ahead.",
      "1",
    );

    if (!answer) return;

    const offset = Number(answer);

    if (!Number.isFinite(offset) || offset < 1 || offset > 4) {
      showStatus("Copy cancelled. Enter a number from 1 to 4.");
      return;
    }

    const sourceWeekId = getWeekId(week);
    const targetWeek = addWeeks(week, offset);
    const targetWeekId = getWeekId(targetWeek);
    const source = rota[company]?.[sourceWeekId] || {};
    const copied: Record<string, Shift[]> = {};

    for (let i = 0; i < 7; i += 1) {
      copied[getDayId(targetWeek, i)] = (source[getDayId(week, i)] || []).map(
        cloneShift,
      );
    }

    setRota((current) => ({
      ...current,
      [company]: {
        ...current[company],
        [targetWeekId]: copied,
      },
    }));

    markWeekEdited(company, targetWeek);
    showStatus(
      `${getCompanyName(company)} copied to ${formatWeekLabel(targetWeek)}.`,
    );
  }

  function payrollSettingsForStaff(person?: StaffMember) {
    if (!person) return defaultPayrollStaffSettings;

    const byId = staffPayrollRows.find((row) => row.id === person.id);
    const byName = staffPayrollRows.find(
      (row) =>
        row.name.trim().toLowerCase() === person.name.trim().toLowerCase(),
    );

    return normalisePayrollStaffSettings(
      byId?.payroll_settings || byName?.payroll_settings,
    );
  }

  function paidShiftHours(shift: Shift, person?: StaffMember) {
    return shiftPaidHours(shift, payrollSettingsForStaff(person));
  }

  function breakHoursForShift(shift: Shift, person?: StaffMember) {
    return shiftBreakHours(shift, payrollSettingsForStaff(person));
  }

  function totalsForCompanyWeek(company: CompanyKey, week: Date) {
    const totals: Record<
      string,
      {
        workHours: number;
        holidayHours: number;
        breakHours: number;
        workWage: number;
        holidayWage: number;
      }
    > = {};

    for (const person of staff) {
      totals[person.id] = {
        workHours: 0,
        holidayHours: 0,
        breakHours: 0,
        workWage: 0,
        holidayWage: 0,
      };
    }

    for (let i = 0; i < 7; i += 1) {
      for (const shift of getDayShifts(company, week, i)) {
        if (!shift.staffId) continue;

        const person = staff.find((x) => x.id === shift.staffId);
        const rawHours = rawShiftHours(shift);
        const hours = shift.type === "holiday" ? rawHours : paidShiftHours(shift, person);
        const breakHours = shift.type === "holiday" ? 0 : breakHoursForShift(shift, person);
        const wage = hours * Number(person?.hourlyRate || 0);

        if (!totals[shift.staffId]) {
          totals[shift.staffId] = {
            workHours: 0,
            holidayHours: 0,
            breakHours: 0,
            workWage: 0,
            holidayWage: 0,
          };
        }

        if (shift.type === "holiday") {
          totals[shift.staffId].holidayHours += hours;
          totals[shift.staffId].holidayWage += wage;
        } else {
          totals[shift.staffId].workHours += hours;
          totals[shift.staffId].breakHours += breakHours;
          totals[shift.staffId].workWage += wage;
        }
      }
    }

    return totals;
  }

  function finalisedPayrollPayload(company: CompanyKey, week: Date) {
    const staffTotals = totalsForCompanyWeek(company, week);
      const shifts: {
      staffId: string;
      staffName: string;
      type: ShiftType;
      hours: number;
      rawHours: number;
      paidHours: number;
      breakHours: number;
      weekId: string;
      dayId: string;
      date: string;
      start: string;
      end: string;
    }[] = [];

    for (let i = 0; i < 7; i += 1) {
      const dayDate = addDays(week, i);
      const dayId = getDayId(week, i);

      for (const shift of getDayShifts(company, week, i)) {
        if (!shift.staffId) continue;

        const person = staff.find((x) => x.id === shift.staffId);
        const rawHours = rawShiftHours(shift);
        const paidHours = shift.type === "holiday" ? rawHours : paidShiftHours(shift, person);
        const breakHours = shift.type === "holiday" ? 0 : breakHoursForShift(shift, person);

        shifts.push({
          staffId: shift.staffId,
          staffName: person?.name || "Unknown staff",
          type: shift.type,
          hours: paidHours,
          rawHours,
          paidHours,
          breakHours,
          weekId: getWeekId(week),
          dayId,
          date: dateKey(dayDate),
          start: shift.start,
          end: shift.end,
        });
      }
    }

    return {
      version: 2,
      staffTotals,
      shifts,
    };
  }

  function companyWeekTotal(company: CompanyKey, week: Date) {
    const totals = totalsForCompanyWeek(company, week);

    return Object.values(totals).reduce(
      (sum, row) => ({
        workHours: sum.workHours + row.workHours,
        holidayHours: sum.holidayHours + row.holidayHours,
        wage: sum.wage + row.workWage + row.holidayWage,
      }),
      { workHours: 0, holidayHours: 0, wage: 0 },
    );
  }

  function saveWeeklyReportSnapshot(company: CompanyKey, week: Date) {
    const weekId = getWeekId(week);
    const totals = totalsForCompanyWeek(company, week);
    const staffTotals: WeeklyReport["staffTotals"] = {};

    for (const person of staff) {
      const row = totals[person.id] || {
        workHours: 0,
        holidayHours: 0,
        breakHours: 0,
        workWage: 0,
        holidayWage: 0,
      };

      staffTotals[person.id] = {
        name: person.name,
        workHours: row.workHours,
        holidayHours: row.holidayHours,
        breakHours: row.breakHours,
        workWage: row.workWage,
        holidayWage: row.holidayWage,
      };
    }

    const report: WeeklyReport = {
      id: `${company}-${weekId}`,
      company,
      weekId,
      companyName: getCompanyName(company),
      staffTotals,
      createdAt: new Date().toISOString(),
    };

    setWeeklyReports((current) => {
      const withoutCurrent = current.filter((row) => row.id !== report.id);
      return [report, ...withoutCurrent].slice(0, 250);
    });
  }

  function isWeekFinalised(company: CompanyKey, week: Date) {
    return Boolean(finalisedWeekIds[`${company}-${getWeekId(week)}`]);
  }

  async function syncFinalisedWeekForAccounts(company: CompanyKey, week: Date, ask = true) {
    const weekId = getWeekId(week);
    const totals = finalisedPayrollPayload(company, week);

    if (ask && !window.confirm(`Finalise ${getCompanyName(company)} week ${weekId} for accounts?`)) {
      return;
    }

    saveWeeklyReportSnapshot(company, week);

    try {
      const { error } = await supabase.from("rota_week_finalisations").upsert(
        {
          company_key: company,
          week_id: weekId,
          status: "finalised",
          totals,
          finalised_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_key,week_id" },
      );

      if (error) throw error;

      showStatus(`${getCompanyName(company)} week ${weekId} finalised for accounts.`);
      setFinalisedWeekIds((current) => ({
        ...current,
        [`${company}-${weekId}`]: true,
      }));
    } catch (error: any) {
      console.error("ROTA_FINALISE_ERROR", error);
      showStatus(error.message || "Weekly report saved locally. Accounts finalisation did not sync.");
    }
  }

  async function finaliseWeekForAccounts(company: CompanyKey, week: Date) {
    await syncFinalisedWeekForAccounts(company, week, true);
  }

  async function updateHistoryFinalisedWeek() {
    if (!historyEditWeekId) return;
    const week = getWeekFromId(historyEditWeekId);
    const finalisedCompanies = companies.filter((company) =>
      isWeekFinalised(company.key, week),
    );
    const companiesToUpdate = finalisedCompanies.length > 0 ? finalisedCompanies : companies;

    for (const company of companiesToUpdate) {
      await syncFinalisedWeekForAccounts(company.key, week, false);
    }

    setHistoryEditDirty(false);
    showStatus(`Finalised rota updated for ${formatWeekLabel(week)}.`);
  }

  async function closeHistoryEdit() {
    if (!historyEditWeekId) return;

    if (historyEditDirty) {
      const updateFirst = window.confirm(
        "This historical week has changes that are not updated in the finalised accounts record yet. Update finalised before closing?",
      );

      if (updateFirst) await updateHistoryFinalisedWeek();
    }

    setHistoryEditWeekId(null);
    setHistoryEditDirty(false);
  }

  function syncGoogleCalendar() {
    window.location.href = "/api/rota/google/connect";
  }

  function openMonthlyCalendar() {
    window.location.href = "/rota/calendar";
  }

  function saveStaffSettings() {
    setSettingsOpen(false);
    showStatus("Settings saved.");
  }

  async function sendTelegram(company: CompanyKey, week: Date) {
    const companyName = getCompanyName(company);
    const weekLabel = formatWeekLabel(week);
    const sentKey = `${company}-${getWeekId(week)}`;
    const alreadySent = Boolean(telegramSentWeeks[sentKey]);

    if (telegramSendingWeeks[sentKey]) {
      showStatus(`${companyName} rota is already sending.`);
      return;
    }

    if (alreadySent) {
      const confirmed = window.confirm(
        `${companyName} rota for ${weekLabel} has already been sent to Telegram.\n\nSend it again?`,
      );

      if (!confirmed) {
        showStatus("Telegram send cancelled.");
        return;
      }
    }

    const days = dayNames.map((dayName, dayIndex) => {
      const actualDate = addDays(week, dayIndex);
      const opening = getOpening(company, dayIndex);
      const closed = isDayClosed(company, week, dayIndex);
      const shifts = getDayShifts(company, week, dayIndex);

      return {
        day: dayName,
        date: actualDate.toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
        }),
        opening: closed ? "Closed" : `${opening.open}-${opening.close}`,
        shifts: shifts.map((shift) => {
          const person = staff.find((x) => x.id === shift.staffId);

          return {
            name: person?.name || "Staff",
            type: shift.type,
            time: telegramShiftTimeLabel(shift, opening, closed),
          };
        }),
      };
    });

    try {
      setTelegramSendingWeeks((current) => ({
        ...current,
        [sentKey]: true,
      }));

      showStatus(`Sending ${companyName} rota to Telegram...`);

      const response = await fetch("/api/rota/send-telegram", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          company,
          companyName,
          weekLabel,
          days,
          staffNames: staff.map((person) => person.name),
          resend: alreadySent,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.ok) {
        const telegramDescription = data?.telegramData?.description;
        const telegramErrorCode = data?.telegramData?.error_code;
        const retryAfter = data?.telegramData?.parameters?.retry_after;
        const detailedMessage = telegramDescription
          ? `${telegramErrorCode ? `Telegram ${telegramErrorCode}: ` : ""}${telegramDescription}${
              retryAfter ? ` Try again in ${retryAfter} seconds.` : ""
            }`
          : data?.message || "Telegram send failed.";

        throw new Error(detailedMessage);
      }

      setTelegramSentWeeks((current) => ({
        ...current,
        [sentKey]: true,
      }));

      showStatus(`${companyName} rota sent to Telegram.`);
    } catch (error: any) {
      console.error("ROTA_TELEGRAM_SEND_ERROR", error);
      showStatus(error.message || "Telegram send failed.");
    } finally {
      setTelegramSendingWeeks((current) => {
        const next = { ...current };
        delete next[sentKey];
        return next;
      });
    }
  }

  function ShiftEditor() {
    const endTimePickerRef = useRef<TimePickerFieldHandle | null>(null);

    if (!activeEditor || !draftShift) return null;

    const week = getWeekFromId(activeEditor.weekId);
    const actualDate = addDays(week, activeEditor.dayIndex);
    const events = calendarEvents[getDayId(week, activeEditor.dayIndex)] || [];
    const opening = getOpening(activeEditor.company, activeEditor.dayIndex);

    return (
      <div
        onClick={(event) => event.stopPropagation()}
        className="fixed left-1/2 top-20 z-50 w-[min(440px,92vw)] -translate-x-1/2 cursor-default rounded-3xl border border-neutral-300 bg-white p-3 shadow-2xl xl:absolute xl:left-0 xl:top-0 xl:translate-x-0"
      >
        <div className="mb-3">
          <p className="text-lg font-black">
            {dayNames[activeEditor.dayIndex]}
          </p>
          <p className="text-sm font-bold text-neutral-500">
            {actualDate.toLocaleDateString("en-GB", {
              weekday: "long",
              day: "2-digit",
              month: "long",
            })}
          </p>

          <div className="mt-3">
            <select
              value={draftShift.staffId}
              onChange={(event) =>
                updateDraftShift({ staffId: event.target.value })
              }
              className="w-full rounded-lg border border-neutral-200 px-2 py-2 text-xs font-bold"
            >
              <option value="">Select staff</option>
              {staff.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                reopenSpecificDay(
                  activeEditor.company,
                  week,
                  activeEditor.dayIndex,
                );
                updateDraftShift({ type: "work" });
              }}
              className={`rounded-xl px-4 py-2 text-xs font-black ${
                draftShift.type === "work"
                  ? "bg-black text-white"
                  : "bg-neutral-100 text-neutral-400"
              }`}
            >
              SHIFT
            </button>

            <button
              type="button"
              onClick={() => {
                reopenSpecificDay(
                  activeEditor.company,
                  week,
                  activeEditor.dayIndex,
                );
                updateDraftShift({
                  type: "holiday",
                  holidayHours: draftShift.holidayHours || 7,
                });
              }}
              className={`rounded-xl px-4 py-2 text-xs font-black ${
                draftShift.type === "holiday"
                  ? "bg-amber-600 text-white"
                  : "bg-neutral-100 text-neutral-400"
              }`}
            >
              HOLIDAY
            </button>

            <button
              type="button"
              onClick={() =>
                closeSpecificDay(
                  activeEditor.company,
                  week,
                  activeEditor.dayIndex,
                )
              }
              className="rounded-xl bg-red-100 px-4 py-2 text-xs font-black text-red-600"
            >
              SHOP CLOSED
            </button>
          </div>
        </div>

        <div
          className={`relative rounded-xl border p-2 pr-16 shadow-sm ${
            draftShift.type === "holiday"
              ? "border-amber-200 bg-amber-50"
              : "border-neutral-200 bg-white"
          }`}
        >
          <div className="absolute right-2 top-2 flex gap-1">
            <button
              type="button"
              onClick={saveDraftShift}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-xs font-black text-emerald-700"
            >
              ✓
            </button>
            <button
              type="button"
              onClick={requestCloseEditor}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-xs font-black text-red-600"
            >
              ×
            </button>
          </div>

          {draftShift.type === "holiday" ? (
            <div className="rounded-xl bg-amber-100 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-black text-amber-700">HOLS</span>
                <input
                  type="number"
                  value={draftShift.holidayHours}
                  onChange={(event) =>
                    updateDraftShift({
                      holidayHours: Number(event.target.value),
                    })
                  }
                  className="w-20 rounded-lg border border-amber-200 px-2 py-2 text-xs font-black"
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-[90px_90px_1fr] gap-2 sm:grid-cols-[110px_110px_1fr]">
              <TimePickerField
                value={draftShift.start}
                onChange={(value) => updateDraftShift({ start: value })}
                onAccepted={() => endTimePickerRef.current?.openPicker()}
              />
              <TimePickerField
                ref={endTimePickerRef}
                value={draftShift.end}
                onChange={(value) => updateDraftShift({ end: value })}
              />
              <button
                type="button"
                onClick={() => {
                  reopenSpecificDay(
                    activeEditor.company,
                    week,
                    activeEditor.dayIndex,
                  );
                  updateDraftShift({
                    type: "work",
                    start: opening.open,
                    end: opening.close,
                  });
                }}
                className="min-w-0 rounded-lg bg-cyan-100 px-2 py-2 text-[10px] font-black text-cyan-800"
              >
                FULL DAY
              </button>
            </div>
          )}

          <input
            value={draftShift.note || ""}
            onChange={(event) => updateDraftShift({ note: event.target.value })}
            placeholder="Note"
            className="mt-2 w-full rounded-lg border border-neutral-200 px-2 py-2 text-xs"
          />
        </div>

        <div className="mt-3 rounded-2xl bg-blue-50 p-3">
          <p className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-blue-500">
            <GoogleCalendarLogo />
            Google Calendar
          </p>

          {!googleCalendarSynced ? (
            <p className="text-xs font-bold text-blue-400">
              Calendar entries will be displayed here once Google Calendar is
              synced.
            </p>
          ) : events.length === 0 ? (
            <p className="text-xs font-bold text-blue-400">
              No calendar entries for this day.
            </p>
          ) : (
            <div className="space-y-1">
              {events.map((event) => (
                <div
                  key={event.id}
                  className="rounded-lg bg-white px-2 py-1 text-xs font-bold text-blue-700"
                >
                  {event.start}–{event.end} · {event.title}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  function DayDetailPopup() {
    if (!expandedDay) return null;

    const week = getWeekFromId(expandedDay.weekId);
    const actualDate = addDays(week, expandedDay.dayIndex);
    const shifts = getDayShiftsByWeekId(
      expandedDay.company,
      expandedDay.weekId,
      expandedDay.dayIndex,
    );
    const opening = getOpening(expandedDay.company, expandedDay.dayIndex);
    const closed = isDayClosed(expandedDay.company, week, expandedDay.dayIndex);
    const events = calendarEvents[getDayId(week, expandedDay.dayIndex)] || [];

    return (
      <div
        className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-3 py-16"
        onClick={() => setExpandedDay(null)}
      >
        <div
          onClick={(event) => event.stopPropagation()}
          className="w-[min(520px,94vw)] rounded-3xl border border-neutral-300 bg-white p-4 shadow-2xl"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-neutral-400">
                {getCompanyName(expandedDay.company)}
              </p>
              <h2 className="text-2xl font-black">
                {dayNames[expandedDay.dayIndex]}
              </h2>
              <p className="text-sm font-bold text-neutral-500">
                {actualDate.toLocaleDateString("en-GB", {
                  weekday: "long",
                  day: "2-digit",
                  month: "long",
                })}
              </p>
              <p className="mt-1 text-xs font-black text-cyan-700">
                {openingTimeLabel(opening, true, closed)}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setExpandedDay(null)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100 text-sm font-black text-red-600"
            >
              ×
            </button>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {!closed ? (
              <>
                <button
                  type="button"
                  onClick={() =>
                    openNewShift(
                      expandedDay.company,
                      week,
                      expandedDay.dayIndex,
                      "work",
                    )
                  }
                  className="rounded-xl bg-black px-4 py-2 text-xs font-black text-white"
                >
                  Add shift
                </button>
                <button
                  type="button"
                  onClick={() =>
                    openNewShift(
                      expandedDay.company,
                      week,
                      expandedDay.dayIndex,
                      "holiday",
                    )
                  }
                  className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-black text-white"
                >
                  Holiday
                </button>
                <button
                  type="button"
                  onClick={() =>
                    closeSpecificDay(
                      expandedDay.company,
                      week,
                      expandedDay.dayIndex,
                    )
                  }
                  className="rounded-xl bg-red-100 px-4 py-2 text-xs font-black text-red-600"
                >
                  Close day
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() =>
                  reopenSpecificDay(
                    expandedDay.company,
                    week,
                    expandedDay.dayIndex,
                  )
                }
                className="rounded-xl bg-emerald-100 px-4 py-2 text-xs font-black text-emerald-700"
              >
                Reopen day
              </button>
            )}
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl bg-neutral-100 p-3">
              <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-neutral-400">
                Shifts
              </p>

              {shifts.length === 0 ? (
                <p className="rounded-xl bg-white p-3 text-xs font-bold text-neutral-400">
                  No shifts for this day.
                </p>
              ) : (
                <div className="space-y-2">
                  {shifts.map((shift) => {
                    const person = staff.find((x) => x.id === shift.staffId);

                    return (
                      <div
                        key={shift.id}
                        className={`relative rounded-xl p-3 pr-20 text-xs font-bold ${
                          shift.type === "holiday"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-white text-neutral-800"
                        }`}
                      >
                        <p className="font-black">{person?.name || "Staff"}</p>
                        <p className="mt-1 opacity-80">
                          {shiftTimeLabel(shift, opening, closed)}
                        </p>
                        {shift.note && (
                          <p className="mt-1 opacity-70">{shift.note}</p>
                        )}

                        <div className="absolute right-2 top-2 flex gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              openExistingShift(
                                expandedDay.company,
                                week,
                                expandedDay.dayIndex,
                                shift,
                              )
                            }
                            className="rounded-lg bg-cyan-100 px-2 py-1 text-[10px] font-black text-cyan-800"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              quickDeleteShift(
                                expandedDay.company,
                                week,
                                expandedDay.dayIndex,
                                shift.id,
                              )
                            }
                            className="rounded-lg bg-red-100 px-2 py-1 text-[10px] font-black text-red-600"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-2xl bg-blue-50 p-3">
              <p className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-blue-500">
                <GoogleCalendarLogo />
                Google Calendar
              </p>

              {!googleCalendarSynced ? (
                <p className="rounded-xl bg-white p-3 text-xs font-bold text-blue-400">
                  Sync Google Calendar to show events here.
                </p>
              ) : events.length === 0 ? (
                <p className="rounded-xl bg-white p-3 text-xs font-bold text-blue-400">
                  No calendar entries for this day.
                </p>
              ) : (
                <div className="space-y-2">
                  {events.map((event) => (
                    <div
                      key={event.id}
                      className="rounded-xl bg-white p-3 text-xs font-bold text-blue-700"
                    >
                      <p className="font-black">{event.title}</p>
                      <p className="mt-1 opacity-80">
                        {event.start}
                        {event.end && event.end !== "All day"
                          ? `–${event.end}`
                          : ""}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function CalendarEventPill({ event }: { event: CalendarEvent }) {
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        className="group relative z-10 min-h-8 rounded-lg bg-blue-50 px-1.5 py-1 text-[10px] font-black leading-tight text-blue-700 transition-all duration-150 hover:z-30 hover:min-h-20 hover:scale-[1.03] hover:bg-blue-100 hover:p-2 hover:shadow-2xl"
      >
        <div className="flex min-h-6 flex-col justify-center">
          <span className="truncate group-hover:whitespace-normal group-hover:break-words">
            {event.title}
          </span>
          <span className="truncate text-[9px] opacity-80 group-hover:whitespace-normal">
            {event.start}
            {event.end && event.end !== "All day" ? `–${event.end}` : ""}
          </span>
        </div>
      </div>
    );
  }

  function DayCard({
    company,
    week,
    dayIndex,
  }: {
    company: CompanyKey;
    week: Date;
    dayIndex: number;
  }) {
    const actualDate = addDays(week, dayIndex);
    const shifts = getDayShifts(company, week, dayIndex);
    const opening = getOpening(company, dayIndex);
    const closed = isDayClosed(company, week, dayIndex);
    const events = calendarEvents[getDayId(week, dayIndex)] || [];
    const openingFullLabel = openingTimeLabel(opening, true, closed);
    const weekId = getWeekId(week);
    const expanded =
      expandedDay?.company === company &&
      expandedDay.weekId === weekId &&
      expandedDay.dayIndex === dayIndex;

    const editorOpenHere =
      activeEditor?.company === company &&
      activeEditor.weekId === weekId &&
      activeEditor.dayIndex === dayIndex;

    return (
      <div
        className={`relative min-h-44 cursor-pointer rounded-2xl border p-2 ${
          expanded ? "ring-2 ring-cyan-400" : ""
        } ${
          closed
            ? "border-red-200 bg-red-50"
            : "border-neutral-200 bg-neutral-50"
        }`}
        onClick={() => toggleExpandedDay(company, week, dayIndex)}
      >
        <div className="mb-2">
          <div className="grid grid-cols-[34px_1fr] items-baseline gap-1">
            <p className="text-sm font-black">{dayNames[dayIndex]}</p>
            <span className="min-w-0 text-right text-[10px] font-black leading-tight text-cyan-700 sm:text-[11px]">
              {openingFullLabel}
            </span>
          </div>
          <p className="text-xs font-bold text-neutral-400">
            {actualDate.toLocaleDateString("en-GB", {
              day: "2-digit",
              month: "short",
            })}
          </p>
        </div>

        <div className="space-y-1">
          {shifts.map((shift) => {
            const person = staff.find((x) => x.id === shift.staffId);

            return (
              <div
                key={shift.id}
                onClick={(event) => {
                  event.stopPropagation();
                  openExistingShift(company, week, dayIndex, shift);
                }}
                className={`relative flex min-h-9 cursor-pointer flex-col justify-center rounded-lg px-1.5 py-1 pr-4 text-[10px] font-black leading-tight ${
                  shift.type === "holiday"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-white text-neutral-800"
                }`}
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    quickDeleteShift(company, week, dayIndex, shift.id);
                  }}
                  className="absolute right-1 top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-red-100 text-[10px] font-black text-red-600"
                >
                  ×
                </button>
                <span className="truncate pr-1">{person?.name || "Staff"}</span>
                <span className="truncate text-[9px] opacity-80">
                  {shiftTimeLabel(shift, opening, closed)}
                </span>
              </div>
            );
          })}

          {events.slice(0, 2).map((event) => (
            <CalendarEventPill key={event.id} event={event} />
          ))}

          {events.length > 2 && (
            <div className="rounded-lg bg-blue-100 px-1.5 py-1 text-[10px] font-black text-blue-700">
              +{events.length - 2} more calendar
            </div>
          )}

          {!closed && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openNewShift(company, week, dayIndex, "work");
              }}
              className="flex min-h-9 w-full items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-white/70 px-2 py-1 text-xs font-black text-neutral-400 hover:border-neutral-500 hover:text-neutral-700"
            >
              + SHIFT
            </button>
          )}
        </div>

        {editorOpenHere && <ShiftEditor />}
      </div>
    );
  }

  function WeekPlanner({
    company,
    week,
    previousFinalise = false,
  }: {
    company: Company;
    week: Date;
    previousFinalise?: boolean;
  }) {
    const total = companyWeekTotal(company.key, week);
    const staffTotals = totalsForCompanyWeek(company.key, week);
    const current = isCurrentWeek(week);
    const telegramSentKey = `${company.key}-${getWeekId(week)}`;
    const telegramAlreadySent = Boolean(telegramSentWeeks[telegramSentKey]);
    const telegramSending = Boolean(telegramSendingWeeks[telegramSentKey]);

    return (
      <section
        className={`rounded-3xl border p-4 shadow-xl ${
          previousFinalise
            ? "border-red-800 bg-red-200 ring-4 ring-red-300"
            : current
            ? "border-emerald-700 bg-emerald-200 ring-4 ring-emerald-300"
            : "border-neutral-200 bg-white"
        }`}
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <CompanyLogo company={company} />
            <div className="min-w-0">
              <p className={`truncate text-xs font-black uppercase tracking-[0.2em] ${
                previousFinalise ? "text-red-800" : "text-neutral-400"
              }`}>
                {previousFinalise ? "Previous week" : company.name}
              </p>
              <h2 className="text-xl font-black">
                {formatWeekLabel(week)}
                {previousFinalise && (
                  <span className="ml-2 rounded-full bg-red-800 px-2 py-1 align-middle text-[10px] font-black uppercase tracking-widest text-white">
                    FINALISE
                  </span>
                )}
                {current && (
                  <span className="ml-2 rounded-full bg-emerald-800 px-2 py-1 align-middle text-[10px] font-black uppercase tracking-widest text-white">
                    CURRENT WEEK
                  </span>
                )}
              </h2>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setWeekAsDefault(company.key, week)}
              className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white"
            >
              Set default
            </button>
            <button
              type="button"
              onClick={() => copyWeekToNext(company.key, week)}
              className="rounded-xl bg-black px-3 py-2 text-xs font-black text-white"
            >
              Copy week
            </button>
            <button
              type="button"
              onClick={() => sendTelegram(company.key, week)}
              disabled={telegramSending}
              className={`rounded-xl px-3 py-2 text-xs font-black text-white disabled:opacity-50 ${
                telegramAlreadySent ? "bg-emerald-600" : "bg-sky-500"
              }`}
            >
              {telegramSending
                ? "Sending..."
                : telegramAlreadySent
                  ? "Telegram sent OK"
                  : "Telegram"}
            </button>
            {previousFinalise && (
              <button
                type="button"
                onClick={() => finaliseWeekForAccounts(company.key, week)}
                className="keep-dark-text rounded-xl bg-white px-3 py-2 text-xs font-black text-black shadow"
              >
                Finalise for accounts
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
          {dayNames.map((_, dayIndex) => (
            <DayCard
              key={`${company.key}-${getDayId(week, dayIndex)}`}
              company={company.key}
              week={week}
              dayIndex={dayIndex}
            />
          ))}
        </div>

        <div className="mt-4 rounded-2xl bg-cyan-950 p-3 text-white">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-black">Weekly totals</p>
            <p className="text-sm font-black text-cyan-100">
              {total.workHours.toFixed(2)} work ·{" "}
              {total.holidayHours.toFixed(2)} holiday · {money(total.wage)}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {staff.map((person) => {
              const row = staffTotals[person.id] || {
                workHours: 0,
                holidayHours: 0,
                breakHours: 0,
                workWage: 0,
                holidayWage: 0,
              };

              return (
                <div
                  key={person.id}
                  className="rounded-xl bg-cyan-100 p-2 text-xs font-bold text-cyan-950"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>{person.name}</span>
                    <span>
                      {(row.workHours + row.holidayHours).toFixed(2)} hrs
                    </span>
                  </div>

                  <div className="mt-1 grid grid-cols-2 gap-1 text-cyan-700">
                    <span>Work {row.workHours.toFixed(2)}h</span>
                    <span className="text-right">{money(row.workWage)}</span>
                    <span>Break {row.breakHours.toFixed(2)}h</span>
                    <span className="text-right">deducted</span>
                    <span>Holiday {row.holidayHours.toFixed(2)}h</span>
                    <span className="text-right">{money(row.holidayWage)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

  function PreviousWeekFinaliseCard({ company }: { company: Company }) {
    const week = previousWeekStart;
    if (isWeekFinalised(company.key, week)) return null;

    return <WeekPlanner company={company} week={week} previousFinalise />;
  }

  function PreviousWeekFinaliseGroup() {
    return (
      <>
        <div className="hidden grid-cols-1 gap-5 xl:grid xl:grid-cols-2">
          {companies.map((company) => (
            <PreviousWeekFinaliseCard key={`${company.key}-previous-finalise`} company={company} />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-5 xl:hidden">
          {mobileCompanyList.map((company) => (
            <PreviousWeekFinaliseCard key={`${company.key}-previous-finalise-mobile`} company={company} />
          ))}
        </div>
      </>
    );
  }

  function WeekGroup({ week }: { week: Date }) {
    return (
      <>
        <div className="hidden grid-cols-1 gap-5 xl:grid xl:grid-cols-2">
          {companies.map((company) => (
            <WeekPlanner
              key={`${company.key}-${dateKey(week)}`}
              company={company}
              week={week}
            />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-5 xl:hidden">
          {mobileCompanyList.map((company) => (
            <WeekPlanner
              key={`${company.key}-${dateKey(week)}-mobile`}
              company={company}
              week={week}
            />
          ))}
        </div>
      </>
    );
  }

  function reportTotal(report?: WeeklyReport) {
    if (!report) return { workHours: 0, holidayHours: 0, wage: 0 };

    return Object.values(report.staffTotals).reduce(
      (sum, row) => ({
        workHours: sum.workHours + row.workHours,
        holidayHours: sum.holidayHours + row.holidayHours,
        wage: sum.wage + row.workWage + row.holidayWage,
      }),
      { workHours: 0, holidayHours: 0, wage: 0 },
    );
  }

  function HistoryCompanyCard({
    company,
    report,
    weekId,
  }: {
    company: Company;
    report?: WeeklyReport;
    weekId: string;
  }) {
    const week = getWeekFromId(weekId);
    const finalised = isWeekFinalised(company.key, week);
    const total = reportTotal(report);
    const staffRows = report ? Object.values(report.staffTotals) : [];

    return (
      <div className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <CompanyLogo company={company} />
            <div className="min-w-0">
              <p className="truncate text-lg font-black">{getCompanyName(company.key)}</p>
              <p className="text-xs font-bold text-neutral-500">
                {report
                  ? `Saved ${new Date(report.createdAt).toLocaleString("en-GB")}`
                  : "No saved history snapshot"}
              </p>
            </div>
          </div>

          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${
              finalised
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            {finalised ? "✓ Finalised" : "Not finalised"}
          </span>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2">
          <div className="rounded-2xl bg-neutral-100 p-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-neutral-400">Work</p>
            <p className="mt-1 text-xl font-black">{total.workHours.toFixed(2)}h</p>
          </div>
          <div className="rounded-2xl bg-blue-50 p-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-400">Holiday</p>
            <p className="mt-1 text-xl font-black text-blue-800">{total.holidayHours.toFixed(2)}h</p>
          </div>
          <div className="rounded-2xl bg-emerald-50 p-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500">Wage</p>
            <p className="mt-1 text-xl font-black text-emerald-800">{money(total.wage)}</p>
          </div>
        </div>

        {staffRows.length === 0 ? (
          <p className="rounded-2xl bg-neutral-100 p-4 text-sm font-bold text-neutral-400">
            Edit the week to create a saved history snapshot.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {staffRows.map((row) => (
              <div key={row.name} className="rounded-2xl border border-neutral-100 bg-neutral-50 p-3 text-xs font-bold">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-black">{row.name}</span>
                  <span className="rounded-full bg-white px-2 py-1 font-black">
                    {(row.workHours + row.holidayHours).toFixed(2)}h
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-neutral-500">
                  <span>Work {row.workHours.toFixed(2)}h</span>
                  <span className="text-right">{money(row.workWage)}</span>
                  <span>Break {(row.breakHours || 0).toFixed(2)}h</span>
                  <span className="text-right">deducted</span>
                  <span>Holiday {row.holidayHours.toFixed(2)}h</span>
                  <span className="text-right">{money(row.holidayWage)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setHistoryEditWeekId(weekId);
              setHistoryEditDirty(false);
            }}
            className="rounded-2xl bg-black px-4 py-2 text-sm font-black text-white"
          >
            Edit week
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className="rota-page min-h-screen bg-neutral-100 text-neutral-950">
      {activeEditor && (
        <div
          className="fixed inset-0 z-40 bg-transparent"
          onClick={requestCloseEditor}
        />
      )}
      <DayDetailPopup />

      <div className="mx-auto max-w-[1900px] space-y-5 p-3 sm:p-4">
        <header className="app-header rounded-3xl bg-black p-4 text-white shadow-2xl sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.25em] text-white/50">
                Staff rota
              </p>
              <h1 className="text-3xl font-black tracking-tight">
                Weekly Planner
              </h1>
              <p className="mt-1 text-sm font-semibold text-white/60">
                Two-company rota · current week + next 4 weeks · staff hours ·
                holiday hours · wage totals
              </p>
            </div>

            <div className="grid w-full grid-cols-4 gap-2 sm:w-auto sm:flex sm:flex-wrap sm:justify-end">
              <button
                type="button"
                onClick={() => setHistoryOpen((value) => !value)}
                className="flex items-center justify-center rounded-2xl bg-white/10 px-2 py-3 text-xs font-black text-white sm:px-4 sm:text-sm"
              >
                History
              </button>

              <button
                type="button"
                onClick={openMonthlyCalendar}
                className="flex items-center justify-center gap-1 rounded-2xl bg-black px-2 py-3 text-xs font-black text-white sm:gap-2 sm:px-4 sm:text-sm"
              >
                <GoogleCalendarLogo />
                Calendar
              </button>

              <button
                type="button"
                onClick={syncGoogleCalendar}
                className={`flex items-center justify-center gap-1 rounded-2xl px-2 py-3 text-xs font-black sm:gap-2 sm:px-4 sm:text-sm ${
                  googleCalendarSynced
                    ? "bg-emerald-600 text-white"
                    : "bg-blue-500 text-white"
                }`}
              >
                <GoogleCalendarLogo />
                {googleCalendarSynced ? "✓" : "Sync"}
              </button>

              <button
                type="button"
                onClick={() => setSettingsOpen((value) => !value)}
                className="flex items-center justify-center rounded-2xl bg-emerald-600 px-2 py-3 text-xs font-black text-white sm:px-4 sm:text-sm"
              >
                Settings
              </button>
            </div>
          </div>

          <div className="mt-4">
            <AppNav current="rota" />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 xl:hidden">
            {companies.map((company, index) => (
              <button
                key={company.key}
                type="button"
                onClick={() => setMobileCompany(company.key)}
                className={`flex min-w-0 items-center justify-center gap-2 rounded-2xl px-3 py-3 text-sm font-black ${
                  mobileCompany === company.key
                    ? "bg-emerald-600 text-white"
                    : "bg-white/10 text-white"
                }`}
              >
                <CompanyLogo company={company} />
                <span className="truncate">Company {index + 1}</span>
              </button>
            ))}
          </div>

          {statusMessage && (
            <div className="mt-4 rounded-2xl bg-white/10 p-3 text-sm font-bold">
              {statusMessage}
            </div>
          )}
        </header>

        {historyOpen && (
          <section className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-xl">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-black">Rota history</h2>
                <p className="text-sm font-semibold text-neutral-500">
                  Saved weekly staff hours for future reports.
                </p>
              </div>

              <input
                value={historySearch}
                onChange={(event) => setHistorySearch(event.target.value)}
                placeholder="Search week, company, staff..."
                className="w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-bold md:w-80"
              />
            </div>

            <div className="space-y-4">
              {filteredHistoryWeeks.length === 0 ? (
                <p className="rounded-2xl bg-neutral-100 p-4 text-sm font-bold text-neutral-400">
                  No saved history yet. Save shifts and weekly totals will
                  appear here.
                </p>
              ) : (
                filteredHistoryWeeks.map(({ weekId, reports }) => (
                  <div
                    key={weekId}
                    className="rounded-[2rem] border border-neutral-200 bg-neutral-50 p-3"
                  >
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-400">
                          Week history
                        </p>
                        <h3 className="text-xl font-black">{formatWeekLabel(getWeekFromId(weekId))}</h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setHistoryEditWeekId(weekId);
                          setHistoryEditDirty(false);
                        }}
                        className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 text-sm font-black text-black shadow-sm"
                      >
                        Edit both companies
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                      {companies.map((company) => (
                        <HistoryCompanyCard
                          key={`${weekId}-${company.key}`}
                          company={company}
                          report={reports[company.key]}
                          weekId={weekId}
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {historyEditWeekId && (
          <section className="rounded-3xl border-2 border-black bg-white p-4 shadow-2xl">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-neutral-400">
                  Editing history
                </p>
                <h2 className="text-2xl font-black">
                  {formatWeekLabel(getWeekFromId(historyEditWeekId))}
                </h2>
                <p className="text-sm font-semibold text-neutral-500">
                  Save shifts here, then use Update finalised in history if the week has already gone to accounts.
                </p>
              </div>

              <button
                type="button"
                onClick={closeHistoryEdit}
                className="rounded-2xl bg-black px-4 py-3 text-sm font-black text-white"
              >
                Close
              </button>
              <button
                type="button"
                onClick={updateHistoryFinalisedWeek}
                className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white"
              >
                Update finalised
              </button>
            </div>

            <WeekGroup key={`history-edit-${historyEditWeekId}`} week={getWeekFromId(historyEditWeekId)} />
          </section>
        )}

        {settingsOpen && (
          <section className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-black">Settings</h2>
                <p className="text-sm font-semibold text-neutral-500">
                  Edit company names, logo URLs, and opening times. Staff are managed
                  from Settings users.
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={saveStaffSettings}
                  className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white"
                >
                  Save
                </button>
              </div>
            </div>

            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              {companies.map((company, index) => (
                <div
                  key={company.key}
                  className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3"
                >
                  <p className="mb-2 text-xs font-black uppercase tracking-widest text-neutral-400">
                    Company {index + 1}
                  </p>

                  <div className="flex items-center gap-3">
                    <CompanyLogo company={company} />

                    <div className="min-w-0 flex-1 space-y-2">
                      <input
                        value={company.name}
                        onChange={(event) =>
                          updateCompany(company.key, {
                            name: event.target.value,
                          })
                        }
                        placeholder="Company name"
                        className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm font-bold"
                      />
                      <input
                        value={company.logoUrl || ""}
                        onChange={(event) =>
                          updateCompany(company.key, {
                            logoUrl: event.target.value,
                          })
                        }
                        placeholder="Logo image URL"
                        className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-xs font-bold"
                      />
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-black uppercase tracking-widest text-neutral-400">
                      Opening times
                    </p>

                    {dayNames.map((day, dayIndex) => {
                      const opening = getOpening(company.key, dayIndex);

                      return (
                        <div
                          key={`${company.key}-${day}`}
                          className="grid grid-cols-[44px_1fr_1fr_70px] items-center gap-2"
                        >
                          <span className="text-xs font-black text-neutral-500">
                            {day}
                          </span>
                          <TimePickerField
                            value={opening.open}
                            disabled={Boolean(opening.closed)}
                            onChange={(value) =>
                              updateOpening(company.key, dayIndex, {
                                open: value,
                              })
                            }
                          />
                          <TimePickerField
                            value={opening.close}
                            disabled={Boolean(opening.closed)}
                            onChange={(value) =>
                              updateOpening(company.key, dayIndex, {
                                close: value,
                              })
                            }
                          />
                          <label className="flex items-center gap-1 text-[10px] font-black text-neutral-500">
                            <input
                              type="checkbox"
                              checked={Boolean(opening.closed)}
                              onChange={(event) =>
                                updateOpening(company.key, dayIndex, {
                                  closed: event.target.checked,
                                })
                              }
                            />
                            Closed
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <PreviousWeekFinaliseGroup />

        <WeekGroup week={currentWeekStart} />

        <section className="space-y-5">
          <h2 className="px-1 text-xl font-black">Next 4 weeks</h2>
          {futureWeekStarts.map((week) => (
            <WeekGroup key={dateKey(week)} week={week} />
          ))}
        </section>
      </div>
    </main>
  );
}

