"use client";

import {
    ArrowDownRight,
    BadgeDollarSign,
    BarChart3,
    CalendarDays,
    CircleDollarSign,
    Layers3,
    ListChecks,
    LogOut,
    Plus,
    Receipt,
    Save,
    Settings2,
    Wallet,
    X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TabKey = "overview" | "sections" | "transactions" | "year";
type TransactionKind = "expense" | "saving" | "transfer" | "adjustment";

type SalaryMonthRow = {
  id: string;
  month: string;
  salary_cop: number;
};

type SalarySectionRow = {
  id: string;
  user_id: string;
  month_id: string;
  name: string;
  percentage: number;
  sort_order: number;
  is_active: boolean;
};

type SalaryTransactionRow = {
  id: string;
  user_id: string;
  month_id: string;
  section_id: string | null;
  kind: TransactionKind;
  amount_cop: number;
  note: string | null;
  occurred_at: string;
};

type SectionDraft = {
  id: string;
  name: string;
  percentage: number;
  sort_order: number;
  is_active: boolean;
};

type TransactionForm = {
  sectionId: string;
  kind: TransactionKind;
  amount: string;
  note: string;
};

type YearMonthSummary = {
  month: string;
  salary_cop: number;
  spent_cop: number;
  saved_cop: number;
  transfer_cop: number;
  adjustment_cop: number;
};

const NAV_ITEMS: Array<{ key: TabKey; label: string; icon: typeof Wallet }> = [
  { key: "overview", label: "Overview", icon: Wallet },
  { key: "sections", label: "Sections", icon: Layers3 },
  { key: "transactions", label: "Transactions", icon: Receipt },
  { key: "year", label: "Year", icon: BarChart3 },
];

const DEFAULT_SECTION_TEMPLATES = [
  { name: "Essentials", percentage: 50 },
  { name: "Savings", percentage: 20 },
  { name: "Lifestyle", percentage: 20 },
  { name: "Buffer", percentage: 10 },
];

const monthFormatter = new Intl.DateTimeFormat("es-CO", { month: "long" });
const currencyFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

const TAB_COPY: Record<TabKey, { eyebrow: string; title: string; description: string }> = {
  overview: {
    eyebrow: "Monthly dashboard",
    title: "Your current month at a glance",
    description: "Salary, carry-over, and section balances stay together so the account feels cumulative.",
  },
  sections: {
    eyebrow: "Section editor",
    title: "Different sections, different view",
    description: "Add, remove, and rename the buckets that shape each month without leaving the dashboard.",
  },
  transactions: {
    eyebrow: "Activity log",
    title: "Track movement inside each bucket",
    description: "Capture expenses, savings, transfers, and adjustments against the current month.",
  },
  year: {
    eyebrow: "Yearly history",
    title: "Review the year as a sequence of balances",
    description: "See totals and month-by-month outcomes in a dedicated reporting view.",
  },
};

function getMonthValue(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function monthToDate(monthValue: string) {
  return `${monthValue}-01`;
}

function capitalizeFirst(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatMonthLabel(monthValue: string) {
  const [year, month] = monthValue.split("-");
  const monthIndex = Number(month) - 1;
  return `${capitalizeFirst(monthFormatter.format(new Date(Number(year), monthIndex, 1)))} ${year}`;
}

function formatCurrency(value: number) {
  return currencyFormatter.format(Number.isFinite(value) ? value : 0);
}

function createDefaultSections() {
  return DEFAULT_SECTION_TEMPLATES.map((section, index) => ({
    id: `temp-${section.name.toLowerCase().replace(/\s+/g, "-")}-${index}`,
    name: section.name,
    percentage: section.percentage,
    sort_order: index,
    is_active: true,
  }));
}

function cloneSectionsFromMonth(monthId: string, sections: SalarySectionRow[]) {
  return sections
    .filter((section) => section.month_id === monthId)
    .sort((left, right) => left.sort_order - right.sort_order)
    .map((section) => ({
      id: section.id,
      name: section.name,
      percentage: Number(section.percentage),
      sort_order: section.sort_order,
      is_active: section.is_active,
    }));
}

function resolveSectionsForMonth(
  monthValue: string,
  months: SalaryMonthRow[],
  sections: SalarySectionRow[],
) {
  const currentMonth = months.find((month) => month.month === monthValue);
  if (currentMonth) {
    const currentMonthSections = cloneSectionsFromMonth(currentMonth.id, sections);
    if (currentMonthSections.length > 0) {
      return currentMonthSections;
    }
  }

  const previousMonth = [...months]
    .filter((month) => month.month < monthValue)
    .sort((left, right) => left.month.localeCompare(right.month))
    .at(-1);

  if (previousMonth) {
    const previousMonthSections = cloneSectionsFromMonth(previousMonth.id, sections);
    if (previousMonthSections.length > 0) {
      return previousMonthSections;
    }
  }

  return createDefaultSections();
}

function normalizeSectionName(name: string) {
  return name.trim().toLowerCase();
}

function buildCarryHistory(
  months: SalaryMonthRow[],
  sections: SalarySectionRow[],
  transactions: SalaryTransactionRow[],
) {
  const sectionsByMonthId = new Map<string, SalarySectionRow[]>();
  const transactionsByMonthId = new Map<string, SalaryTransactionRow[]>();

  for (const section of sections) {
    const list = sectionsByMonthId.get(section.month_id) ?? [];
    list.push(section);
    sectionsByMonthId.set(section.month_id, list);
  }

  for (const transaction of transactions) {
    const list = transactionsByMonthId.get(transaction.month_id) ?? [];
    list.push(transaction);
    transactionsByMonthId.set(transaction.month_id, list);
  }

  const snapshots = new Map<
    string,
    { carryInByName: Record<string, number>; carryOutByName: Record<string, number> }
  >();
  let previousCarryOut: Record<string, number> = {};

  for (const month of [...months].sort((left, right) => left.month.localeCompare(right.month))) {
    const monthSections = sectionsByMonthId.get(month.id) ?? [];
    const monthTransactions = transactionsByMonthId.get(month.id) ?? [];
    const carryInByName = { ...previousCarryOut };
    const carryOutByName: Record<string, number> = {};

    for (const section of monthSections) {
      const sectionNameKey = normalizeSectionName(section.name);
      const allocated = Math.round((month.salary_cop * section.percentage) / 100);
      const used = sumBy(
        monthTransactions.filter((transaction) => transaction.section_id === section.id),
        (transaction) => transaction.amount_cop,
      );
      const available = (carryInByName[sectionNameKey] ?? 0) + allocated - used;

      carryOutByName[sectionNameKey] = available;
    }

    snapshots.set(month.month.slice(0, 7), {
      carryInByName,
      carryOutByName,
    });
    previousCarryOut = carryOutByName;
  }

  return snapshots;
}

function sumValues(values: Record<string, number>) {
  return Object.values(values).reduce((total, value) => total + value, 0);
}

function sumBy<T>(items: T[], getter: (item: T) => number) {
  return items.reduce((total, item) => total + getter(item), 0);
}

function kindLabel(kind: TransactionKind) {
  switch (kind) {
    case "expense":
      return "Expense";
    case "saving":
      return "Saving";
    case "transfer":
      return "Transfer";
    case "adjustment":
      return "Adjustment";
  }
}

function kindTone(kind: TransactionKind) {
  switch (kind) {
    case "expense":
      return "destructive";
    case "saving":
      return "secondary";
    case "transfer":
      return "outline";
    case "adjustment":
      return "default";
  }
}

function monthOptions() {
  return Array.from({ length: 12 }, (_, index) => ({
    value: String(index + 1).padStart(2, "0"),
    label: capitalizeFirst(monthFormatter.format(new Date(2026, index, 1))),
  }));
}

export function SalaryDashboard() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [authLoading, setAuthLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [monthRow, setMonthRow] = useState<SalaryMonthRow | null>(null);
  const [salaryInput, setSalaryInput] = useState("");
  const [sections, setSections] = useState<SectionDraft[]>(() => createDefaultSections());
  const [persistedSectionIds, setPersistedSectionIds] = useState<string[]>([]);
  const [transactions, setTransactions] = useState<SalaryTransactionRow[]>([]);
  const [yearMonths, setYearMonths] = useState<SalaryMonthRow[]>([]);
  const [yearTransactions, setYearTransactions] = useState<SalaryTransactionRow[]>([]);
  const [historyMonths, setHistoryMonths] = useState<SalaryMonthRow[]>([]);
  const [historySections, setHistorySections] = useState<SalarySectionRow[]>([]);
  const [historyTransactions, setHistoryTransactions] = useState<SalaryTransactionRow[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [savingTransaction, setSavingTransaction] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transactionForm, setTransactionForm] = useState<TransactionForm>(() => ({
    sectionId: "",
    kind: "expense",
    amount: "",
    note: "",
  }));

  const selectedYear = selectedMonth.slice(0, 4);
  const selectedMonthDate = selectedMonth ? monthToDate(selectedMonth) : "";
  const activeTabCopy = TAB_COPY[activeTab];

  useEffect(() => {
    setSelectedMonth(getMonthValue());
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        if (!cancelled) {
          setErrorMessage(error.message);
          setAuthLoading(false);
        }
        return;
      }

      if (!cancelled) {
        setUserId(data.user?.id ?? null);
        setAuthLoading(false);
      }
    }

    loadUser();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    let cancelled = false;

    async function loadHistoryData() {
      try {
        const [monthsResult, sectionsResult, transactionsResult] = await Promise.all([
          supabase
            .from("salary_months")
            .select("id, month, salary_cop")
            .eq("user_id", userId)
            .order("month", { ascending: true }),
          supabase
            .from("salary_sections")
            .select("id, user_id, month_id, name, percentage, sort_order, is_active")
            .eq("user_id", userId)
            .order("sort_order", { ascending: true }),
          supabase
            .from("salary_transactions")
            .select("id, user_id, month_id, section_id, kind, amount_cop, note, occurred_at")
            .eq("user_id", userId)
            .order("occurred_at", { ascending: false }),
        ]);

        if (monthsResult.error) {
          throw monthsResult.error;
        }

        if (sectionsResult.error) {
          throw sectionsResult.error;
        }

        if (transactionsResult.error) {
          throw transactionsResult.error;
        }

        if (!cancelled) {
          setHistoryMonths((monthsResult.data ?? []) as SalaryMonthRow[]);
          setHistorySections((sectionsResult.data ?? []) as SalarySectionRow[]);
          setHistoryTransactions((transactionsResult.data ?? []) as SalaryTransactionRow[]);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : "Failed to load history data");
        }
      }
    }

    loadHistoryData();

    return () => {
      cancelled = true;
    };
  }, [supabase, userId]);

  useEffect(() => {
    if (!userId || !selectedMonthDate) {
      return;
    }

    let cancelled = false;

    async function loadMonthData() {
      setLoadingData(true);
      setErrorMessage(null);

      try {
        const { data: monthData, error: monthError } = await supabase
          .from("salary_months")
          .select("id, month, salary_cop")
          .eq("user_id", userId)
          .eq("month", selectedMonthDate)
          .maybeSingle();

        if (monthError) {
          throw monthError;
        }

        if (!monthData) {
          if (!cancelled) {
            setMonthRow(null);
            setSalaryInput("");
            const inheritedSections = resolveSectionsForMonth(selectedMonthDate, historyMonths, historySections);
            setSections(inheritedSections);
            setPersistedSectionIds([]);
            setTransactions([]);
            setTransactionForm((current) => ({
              ...current,
              sectionId: inheritedSections[0]?.id ?? "",
            }));
          }
          return;
        }

        const [sectionsResult, transactionsResult] = await Promise.all([
          supabase
            .from("salary_sections")
            .select("id, user_id, month_id, name, percentage, sort_order, is_active")
            .eq("user_id", userId)
            .eq("month_id", monthData.id)
            .order("sort_order", { ascending: true }),
          supabase
            .from("salary_transactions")
            .select("id, user_id, month_id, section_id, kind, amount_cop, note, occurred_at")
            .eq("user_id", userId)
            .eq("month_id", monthData.id)
            .order("occurred_at", { ascending: false }),
        ]);

        if (sectionsResult.error) {
          throw sectionsResult.error;
        }

        if (transactionsResult.error) {
          throw transactionsResult.error;
        }

        const loadedSections =
          sectionsResult.data?.length > 0
            ? sectionsResult.data.map((section) => ({
                id: section.id,
                name: section.name,
                percentage: Number(section.percentage),
                sort_order: section.sort_order,
                is_active: section.is_active,
              }))
            : resolveSectionsForMonth(selectedMonthDate, historyMonths, historySections);

        if (!cancelled) {
          setMonthRow(monthData);
          setSalaryInput(String(monthData.salary_cop));
          setSections(loadedSections);
          setPersistedSectionIds(sectionsResult.data?.map((section) => section.id) ?? []);
          setTransactions((transactionsResult.data ?? []) as SalaryTransactionRow[]);
          setTransactionForm((current) => ({
            ...current,
            sectionId: loadedSections[0]?.id ?? "",
          }));
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : "Failed to load month data");
        }
      } finally {
        if (!cancelled) {
          setLoadingData(false);
        }
      }
    }

    loadMonthData();

    return () => {
      cancelled = true;
    };
  }, [historyMonths, historySections, selectedMonthDate, supabase, userId]);

  useEffect(() => {
    if (!userId || !selectedYear) {
      return;
    }

    let cancelled = false;

    async function loadYearData() {
      try {
        const startOfYear = `${selectedYear}-01-01`;
        const startOfNextYear = `${Number(selectedYear) + 1}-01-01`;

        const { data: monthsData, error: monthsError } = await supabase
          .from("salary_months")
          .select("id, month, salary_cop")
          .eq("user_id", userId)
          .gte("month", startOfYear)
          .lt("month", startOfNextYear)
          .order("month", { ascending: true });

        if (monthsError) {
          throw monthsError;
        }

        const monthIds = (monthsData ?? []).map((month) => month.id);

        const transactionsData = monthIds.length
          ? await supabase
              .from("salary_transactions")
              .select("id, user_id, month_id, section_id, kind, amount_cop, note, occurred_at")
              .eq("user_id", userId)
              .in("month_id", monthIds)
              .order("occurred_at", { ascending: false })
          : { data: [], error: null };

        if (transactionsData.error) {
          throw transactionsData.error;
        }

        if (!cancelled) {
          setYearMonths((monthsData ?? []) as SalaryMonthRow[]);
          setYearTransactions((transactionsData.data ?? []) as SalaryTransactionRow[]);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : "Failed to load year data");
        }
      }
    }

    loadYearData();

    return () => {
      cancelled = true;
    };
  }, [selectedYear, supabase, userId]);

  useEffect(() => {
    if (!sections.length) {
      return;
    }

    const sectionIds = sections.map((section) => section.id);

    if (!transactionForm.sectionId || !sectionIds.includes(transactionForm.sectionId)) {
      setTransactionForm((current) => ({
        ...current,
        sectionId: sections[0].id,
      }));
    }
  }, [sections, transactionForm.sectionId]);

  function handleTabChange(tab: TabKey) {
    setActiveTab(tab);

    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const sectionUsage = useMemo(() => {
    return transactions.reduce<Record<string, number>>((accumulator, transaction) => {
      if (!transaction.section_id) {
        return accumulator;
      }

      accumulator[transaction.section_id] = (accumulator[transaction.section_id] ?? 0) + transaction.amount_cop;
      return accumulator;
    }, {});
  }, [transactions]);

  const carryHistory = useMemo(
    () => buildCarryHistory(historyMonths, historySections, historyTransactions),
    [historyMonths, historySections, historyTransactions],
  );

  const currentMonthSnapshot = carryHistory.get(selectedMonth);
  const currentCarryInTotal = sumValues(currentMonthSnapshot?.carryInByName ?? {});
  const currentCarryInNamedTotal = sumBy(sections, (section) => {
    const sectionKey = normalizeSectionName(section.name);
    return currentMonthSnapshot?.carryInByName[sectionKey] ?? 0;
  });

  const expenseTotal = useMemo(
    () => sumBy(transactions.filter((transaction) => transaction.kind === "expense"), (transaction) => transaction.amount_cop),
    [transactions],
  );
  const savingsTotal = useMemo(
    () => sumBy(transactions.filter((transaction) => transaction.kind === "saving"), (transaction) => transaction.amount_cop),
    [transactions],
  );
  const salaryValue = Number(salaryInput || monthRow?.salary_cop || 0);
  const totalPercentage = sumBy(sections, (section) => Number(section.percentage) || 0);
  const totalAllocated = salaryValue;
  const totalUsed = sumBy(transactions, (transaction) => transaction.amount_cop);
  const remainingBalance = currentCarryInTotal + totalAllocated - totalUsed;

  const sectionRows = useMemo(
    () =>
      sections.map((section) => {
        const sectionKey = normalizeSectionName(section.name);
        const carryIn = currentMonthSnapshot?.carryInByName[sectionKey] ?? 0;
        const allocated = Math.round((salaryValue * section.percentage) / 100);
        const used = sectionUsage[section.id] ?? 0;
        return {
          ...section,
          carryIn,
          allocated,
          used,
          remaining: carryIn + allocated - used,
        };
      }),
    [currentMonthSnapshot, salaryValue, sectionUsage, sections],
  );

  const yearSummary = useMemo<YearMonthSummary[]>(() => {
    return yearMonths.map((month) => {
      const monthTransactions = yearTransactions.filter((transaction) => transaction.month_id === month.id);
      return {
        month: month.month,
        salary_cop: month.salary_cop,
        spent_cop: sumBy(monthTransactions.filter((transaction) => transaction.kind === "expense"), (transaction) => transaction.amount_cop),
        saved_cop: sumBy(monthTransactions.filter((transaction) => transaction.kind === "saving"), (transaction) => transaction.amount_cop),
        transfer_cop: sumBy(monthTransactions.filter((transaction) => transaction.kind === "transfer"), (transaction) => transaction.amount_cop),
        adjustment_cop: sumBy(monthTransactions.filter((transaction) => transaction.kind === "adjustment"), (transaction) => transaction.amount_cop),
      };
    });
  }, [yearMonths, yearTransactions]);

  const yearTotals = useMemo(
    () =>
      yearSummary.reduce(
        (accumulator, month) => ({
          salary_cop: accumulator.salary_cop + month.salary_cop,
          spent_cop: accumulator.spent_cop + month.spent_cop,
          saved_cop: accumulator.saved_cop + month.saved_cop,
          transfer_cop: accumulator.transfer_cop + month.transfer_cop,
          adjustment_cop: accumulator.adjustment_cop + month.adjustment_cop,
        }),
        {
          salary_cop: 0,
          spent_cop: 0,
          saved_cop: 0,
          transfer_cop: 0,
          adjustment_cop: 0,
        },
      ),
    [yearSummary],
  );

  async function persistCurrentPlan() {
    if (!userId) {
      throw new Error("You must sign in first.");
    }

    const salary = Number(salaryInput);
    const salary_cop = Number.isFinite(salary) && salary >= 0 ? Math.round(salary) : 0;

    const { data: savedMonth, error: monthError } = await supabase
      .from("salary_months")
      .upsert(
        {
          user_id: userId,
          month: selectedMonthDate,
          salary_cop,
        },
        {
          onConflict: "user_id,month",
        },
      )
      .select("id, month, salary_cop")
      .single();

    if (monthError) {
      throw monthError;
    }

    const sectionPayload = sections.map((section, index) => ({
      id: section.id,
      user_id: userId,
      month_id: savedMonth.id,
      name: section.name.trim() || `Section ${index + 1}`,
      percentage: Number(section.percentage) || 0,
      sort_order: index,
      is_active: section.is_active,
    }));

    if (sectionPayload.length) {
      const { error: sectionsError } = await supabase.from("salary_sections").upsert(sectionPayload);
      if (sectionsError) {
        throw sectionsError;
      }
    }

    const removedSectionIds = persistedSectionIds.filter((id) => !sectionPayload.some((section) => section.id === id));
    if (removedSectionIds.length) {
      const { error: deleteError } = await supabase.from("salary_sections").delete().in("id", removedSectionIds);
      if (deleteError) {
        throw deleteError;
      }
    }

    setPersistedSectionIds(sectionPayload.map((section) => section.id));
    return savedMonth;
  }

  async function handleSavePlan() {
    setSavingPlan(true);
    setErrorMessage(null);

    try {
      await persistCurrentPlan();
      await Promise.all([loadCurrentMonth(), loadYearData()]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save plan");
    } finally {
      setSavingPlan(false);
    }
  }

  async function loadCurrentMonth() {
    if (!userId) {
      return;
    }

    const { data: monthData, error: monthError } = await supabase
      .from("salary_months")
      .select("id, month, salary_cop")
      .eq("user_id", userId)
      .eq("month", selectedMonthDate)
      .maybeSingle();

    if (monthError) {
      throw monthError;
    }

    const defaultSections = createDefaultSections();

    if (!monthData) {
      setMonthRow(null);
      setSalaryInput("");
      setSections(defaultSections);
      setPersistedSectionIds([]);
      setTransactions([]);
      setTransactionForm((current) => ({
        ...current,
        sectionId: defaultSections[0]?.id ?? "",
      }));
      return;
    }

    const [sectionsResult, transactionsResult] = await Promise.all([
      supabase
        .from("salary_sections")
        .select("id, user_id, month_id, name, percentage, sort_order, is_active")
        .eq("user_id", userId)
        .eq("month_id", monthData.id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("salary_transactions")
        .select("id, user_id, month_id, section_id, kind, amount_cop, note, occurred_at")
        .eq("user_id", userId)
        .eq("month_id", monthData.id)
        .order("occurred_at", { ascending: false }),
    ]);

    if (sectionsResult.error) {
      throw sectionsResult.error;
    }

    if (transactionsResult.error) {
      throw transactionsResult.error;
    }

    const loadedSections =
      sectionsResult.data?.length > 0
        ? sectionsResult.data.map((section) => ({
            id: section.id,
            name: section.name,
            percentage: Number(section.percentage),
            sort_order: section.sort_order,
            is_active: section.is_active,
          }))
        : defaultSections;

    setMonthRow(monthData);
    setSalaryInput(String(monthData.salary_cop));
    setSections(loadedSections);
    setPersistedSectionIds(sectionsResult.data?.map((section) => section.id) ?? []);
    setTransactions((transactionsResult.data ?? []) as SalaryTransactionRow[]);
    setTransactionForm((current) => ({
      ...current,
      sectionId: loadedSections[0]?.id ?? "",
    }));
  }

  async function loadYearData() {
    if (!userId) {
      return;
    }

    const startOfYear = `${selectedYear}-01-01`;
    const startOfNextYear = `${Number(selectedYear) + 1}-01-01`;

    const { data: monthsData, error: monthsError } = await supabase
      .from("salary_months")
      .select("id, month, salary_cop")
      .eq("user_id", userId)
      .gte("month", startOfYear)
      .lt("month", startOfNextYear)
      .order("month", { ascending: true });

    if (monthsError) {
      throw monthsError;
    }

    const monthIds = (monthsData ?? []).map((month) => month.id);
    const transactionsData = monthIds.length
      ? await supabase
          .from("salary_transactions")
          .select("id, user_id, month_id, section_id, kind, amount_cop, note, occurred_at")
          .eq("user_id", userId)
          .in("month_id", monthIds)
          .order("occurred_at", { ascending: false })
      : { data: [], error: null };

    if (transactionsData.error) {
      throw transactionsData.error;
    }

    setYearMonths((monthsData ?? []) as SalaryMonthRow[]);
    setYearTransactions((transactionsData.data ?? []) as SalaryTransactionRow[]);
  }

  async function handleSectionChange(index: number, field: keyof Pick<SectionDraft, "name" | "percentage">, value: string) {
    setSections((current) =>
      current.map((section, currentIndex) =>
        currentIndex === index
          ? {
              ...section,
              [field]: field === "percentage" ? Number(value) || 0 : value,
            }
          : section,
      ),
    );
  }

  function addSection() {
    setSections((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: "New section",
        percentage: 0,
        sort_order: current.length,
        is_active: true,
      },
    ]);
  }

  function removeSection(sectionId: string) {
    setSections((current) => current.filter((section) => section.id !== sectionId));
    if (transactionForm.sectionId === sectionId) {
      setTransactionForm((current) => ({
        ...current,
        sectionId: sections.find((section) => section.id !== sectionId)?.id ?? "",
      }));
    }
  }

  async function handleAddTransaction() {
    setSavingTransaction(true);
    setErrorMessage(null);

    try {
      const savedMonth = await persistCurrentPlan();
      const amount = Number(transactionForm.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Enter a valid transaction amount.");
      }

      const sectionId = transactionForm.sectionId || sections[0]?.id || null;
      const { error: insertError } = await supabase.from("salary_transactions").insert({
        user_id: userId,
        month_id: savedMonth.id,
        section_id: sectionId,
        kind: transactionForm.kind,
        amount_cop: Math.round(amount),
        note: transactionForm.note.trim() || null,
        occurred_at: new Date().toISOString(),
      });

      if (insertError) {
        throw insertError;
      }

      setTransactionForm((current) => ({
        ...current,
        amount: "",
        note: "",
      }));

      await Promise.all([loadCurrentMonth(), loadYearData()]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to add transaction");
    } finally {
      setSavingTransaction(false);
    }
  }

  async function deleteTransaction(transactionId: string) {
    setErrorMessage(null);
    const { error } = await supabase.from("salary_transactions").delete().eq("id", transactionId);
    if (error) {
      setErrorMessage(error.message);
      return;
    }

    await Promise.all([loadCurrentMonth(), loadYearData()]);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/auth/login");
    router.refresh();
  }

  const navItems = NAV_ITEMS.map((item) => ({
    ...item,
    active: activeTab === item.key,
  }));

  if (authLoading) {
    return (
      <main className="min-h-screen bg-background px-4 py-10 text-foreground">
        <div className="mx-auto flex min-h-[60vh] max-w-xl items-center justify-center">
          <Card className="w-full">
            <CardHeader>
              <CardTitle className="text-2xl">Loading dashboard</CardTitle>
              <CardDescription>Connecting to your Supabase session.</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </main>
    );
  }

  if (!userId) {
    return (
      <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center">
          <Card className="w-full">
            <CardHeader>
              <Badge variant="secondary" className="w-fit">Salary manager</Badge>
              <CardTitle className="text-3xl">Sign in to start tracking your salary in COP</CardTitle>
              <CardDescription className="max-w-2xl">
                This dashboard stores monthly salary records, editable sections, and transactions in Supabase.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row">
              <Button asChild className="bg-sky-500 text-slate-950 hover:bg-sky-400">
                <Link href="/auth/login">Sign in</Link>
              </Button>
              <Button asChild variant="outline" className="border-white/10 bg-transparent text-slate-100 hover:bg-white/10 hover:text-white">
                <Link href="/auth/sign-up">Create account</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <Tabs value={activeTab} onValueChange={(value) => handleTabChange(value as TabKey)}>
      <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.12),_transparent_34%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.08),_transparent_28%),linear-gradient(to_bottom,_rgba(2,6,23,0.01),_transparent_180px)] px-3 pb-56 pt-3 text-foreground sm:px-4 sm:pb-36 lg:px-8 lg:pb-10">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-64 bg-[linear-gradient(to_bottom,_rgba(15,23,42,0.05),_transparent)]" />
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 sm:gap-5">
        <header className="sticky top-3 z-20 rounded-3xl border border-border/60 bg-card/90 p-3 shadow-lg shadow-black/5 ring-1 ring-border/40 backdrop-blur-xl sm:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start justify-between gap-4 lg:items-center">
              <div>
                <Badge variant="secondary" className="w-fit">{activeTabCopy.eyebrow}</Badge>
                <h1 className="mt-2 text-xl font-semibold tracking-tight sm:mt-3 sm:text-2xl lg:text-3xl">{activeTabCopy.title}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-[15px]">{activeTabCopy.description}</p>
              </div>
              <div className="lg:hidden">
                <Button variant="outline" size="icon" onClick={handleSignOut}>
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="space-y-2 sm:min-w-[220px]">
                <div className="text-sm font-medium leading-none">Month</div>
                <Select
                  value={selectedMonth.slice(5)}
                  onValueChange={(value) => setSelectedMonth(`${selectedYear || new Date().getFullYear()}-${value}`)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select month" />
                  </SelectTrigger>
                  <SelectContent>
                    {monthOptions().map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="hidden lg:block">
                <Button variant="outline" onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-4 hidden md:block">
            <TabsList className="grid h-auto w-full grid-cols-4 gap-1 rounded-2xl bg-muted/80 p-1.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <TabsTrigger
                  key={item.key}
                  value={item.key}
                  className="gap-2 rounded-xl data-[state=active]:shadow-sm"
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </TabsTrigger>
              );
            })}
            </TabsList>
          </div>
        </header>

        {errorMessage ? (
          <Alert className="border-border/60 bg-card/90 shadow-sm ring-1 ring-border/40">
            <AlertTitle>Something needs attention</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-3">
              <span>{errorMessage}</span>
              <Button variant="ghost" size="icon" onClick={() => setErrorMessage(null)}>
                <X className="h-4 w-4" />
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={BadgeDollarSign} label="Salary" value={formatCurrency(totalAllocated)} helper={monthRow ? formatMonthLabel(selectedMonth) : "Unsaved month"} />
          <MetricCard icon={ArrowDownRight} label="Spent" value={formatCurrency(expenseTotal)} helper={`${transactions.filter((transaction) => transaction.kind === "expense").length} movements`} />
          <MetricCard icon={CircleDollarSign} label="Saved" value={formatCurrency(savingsTotal)} helper={`${transactions.filter((transaction) => transaction.kind === "saving").length} savings`} />
          <MetricCard icon={Wallet} label="Available" value={formatCurrency(remainingBalance)} helper={monthRow ? `${formatCurrency(currentCarryInNamedTotal)} in named sections` : "Create this month"} />
        </section>

        <Separator />

        {activeTab === "overview" ? (
          <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
            <Card className="border border-border/60 bg-card/90 shadow-sm ring-1 ring-border/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <CalendarDays className="h-5 w-5 text-primary" />
                  Monthly budget
                </CardTitle>
                <CardDescription>Enter the salary for this month and save the section plan that matches it.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-2 text-sm text-slate-300">
                    Salary in COP
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={salaryInput}
                      onChange={(event) => setSalaryInput(event.target.value)}
                      placeholder="0"
                      className="border-white/10 bg-white/5 text-slate-50"
                    />
                  </label>
                  <div className="flex items-end">
                    <Button onClick={handleSavePlan} disabled={savingPlan || loadingData} className="w-full bg-sky-500 text-slate-950 hover:bg-sky-400">
                      <Save className="mr-2 h-4 w-4" />
                      {savingPlan ? "Saving..." : "Save month"}
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg border border-border/60 bg-background/60 p-4 shadow-sm">
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>Allocation progress</span>
                    <span className={cn("font-semibold", totalPercentage === 100 ? "text-emerald-600" : totalPercentage > 100 ? "text-rose-600" : "text-amber-600")}>
                      {totalPercentage}%
                    </span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(totalPercentage, 100)}%` }} />
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {totalPercentage === 100
                      ? "Your salary is fully distributed across sections."
                      : totalPercentage > 100
                        ? "Your sections are above 100%. Reduce one or more percentages."
                        : `You still have ${100 - totalPercentage}% to assign.`}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {sectionRows.map((section) => (
                    <div key={section.id} className="rounded-lg border border-border/60 bg-background/60 p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{section.name}</p>
                          <p className="text-xs text-muted-foreground">{section.percentage}% of salary</p>
                        </div>
                        <Badge variant="outline">
                          {formatCurrency(section.allocated)}
                        </Badge>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                        <div className="rounded-lg border border-border/60 bg-card/90 p-3 shadow-sm">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Carry in</div>
                          <div className="mt-1 font-semibold">{formatCurrency(section.carryIn)}</div>
                        </div>
                        <div className="rounded-lg border border-border/60 bg-card/90 p-3 shadow-sm">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Used</div>
                          <div className="mt-1 font-semibold">{formatCurrency(section.used)}</div>
                        </div>
                        <div className="col-span-2 rounded-lg border border-border/60 bg-card/90 p-3 shadow-sm sm:col-span-1">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Left</div>
                          <div className="mt-1 font-semibold">{formatCurrency(section.remaining)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border border-border/60 bg-card/90 shadow-sm ring-1 ring-border/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Settings2 className="h-5 w-5 text-primary" />
                  Quick summary
                </CardTitle>
                <CardDescription>What this month looks like after the latest data loaded from Supabase.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <SummaryRow label="Month" value={monthRow ? formatMonthLabel(selectedMonth) : "Not saved yet"} />
                <SummaryRow label="Carry in" value={formatCurrency(currentCarryInTotal)} />
                <SummaryRow label="Transactions" value={`${transactions.length} rows`} />
                <SummaryRow label="Sections" value={`${sections.length} editable buckets`} />
                <SummaryRow label="Carry out" value={formatCurrency(remainingBalance)} />
              </CardContent>
            </Card>
          </div>
        ) : null}

        {activeTab === "sections" ? (
          <Card className="border border-border/60 bg-card/90 shadow-sm ring-1 ring-border/40">
              <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Layers3 className="h-5 w-5 text-primary" />
                  Editable sections
                </CardTitle>
                <CardDescription>Add, remove, and rename the sections that split your salary each month.</CardDescription>
              </div>
              <Button onClick={addSection} variant="outline">
                <Plus className="mr-2 h-4 w-4" />
                Add section
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3">
                {sections.map((section, index) => (
                  <div key={section.id} className="rounded-lg border border-border/60 bg-background/60 p-4 shadow-sm">
                    <div className="grid gap-3 md:grid-cols-[1.2fr_0.5fr_auto] md:items-end">
                      <label className="space-y-2 text-sm text-slate-300">
                        Section name
                        <Input value={section.name} onChange={(event) => handleSectionChange(index, "name", event.target.value)} />
                      </label>
                      <label className="space-y-2 text-sm text-slate-300">
                        Percentage
                        <Input type="number" min="0" max="100" step="1" value={section.percentage} onChange={(event) => handleSectionChange(index, "percentage", event.target.value)} />
                      </label>
                      <Button
                        variant="ghost"
                        className="justify-start md:justify-center"
                        onClick={() => removeSection(section.id)}
                      >
                        <X className="mr-2 h-4 w-4" />
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Current total: <span className={cn("font-semibold", totalPercentage === 100 ? "text-emerald-600" : "text-amber-600")}>{totalPercentage}%</span>
                </p>
                <Button onClick={handleSavePlan} disabled={savingPlan || loadingData} className="bg-sky-500 text-slate-950 hover:bg-sky-400">
                  <Save className="mr-2 h-4 w-4" />
                  {savingPlan ? "Saving..." : "Save sections"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {activeTab === "transactions" ? (
          <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
            <Card className="border border-border/60 bg-card/90 shadow-sm ring-1 ring-border/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Receipt className="h-5 w-5 text-primary" />
                  Add transaction
                </CardTitle>
                <CardDescription>Log spending, savings, transfers, or adjustments for the selected month.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="text-sm font-medium leading-none">Section</div>
                  <Select value={transactionForm.sectionId} onValueChange={(value) => setTransactionForm((current) => ({ ...current, sectionId: value }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a section" />
                    </SelectTrigger>
                    <SelectContent>
                      {sections.map((section) => (
                        <SelectItem key={section.id} value={section.id}>
                          {section.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium leading-none">Kind</div>
                  <Select value={transactionForm.kind} onValueChange={(value) => setTransactionForm((current) => ({ ...current, kind: value as TransactionKind }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="expense">Expense</SelectItem>
                      <SelectItem value="saving">Saving</SelectItem>
                      <SelectItem value="transfer">Transfer</SelectItem>
                      <SelectItem value="adjustment">Adjustment</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-2 text-sm font-medium text-foreground">
                    Amount in COP
                    <Input type="number" min="0" step="1" value={transactionForm.amount} onChange={(event) => setTransactionForm((current) => ({ ...current, amount: event.target.value }))} />
                  </label>
                  <label className="space-y-2 text-sm font-medium text-foreground">
                    Note
                    <Input value={transactionForm.note} onChange={(event) => setTransactionForm((current) => ({ ...current, note: event.target.value }))} placeholder="Groceries, transfer, rent..." />
                  </label>
                </div>

                <Button onClick={handleAddTransaction} disabled={savingTransaction || loadingData} className="w-full">
                  <Plus className="mr-2 h-4 w-4" />
                  {savingTransaction ? "Saving..." : "Add transaction"}
                </Button>
              </CardContent>
            </Card>

            <Card className="border bg-card shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <ListChecks className="h-5 w-5 text-primary" />
                  Recent activity
                </CardTitle>
                <CardDescription>Latest transactions for the selected month.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {transactions.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                    No transactions yet for this month.
                  </div>
                ) : (
                  transactions.map((transaction) => {
                    const linkedSection = sections.find((section) => section.id === transaction.section_id);
                    return (
                      <div key={transaction.id} className="rounded-lg border border-border/60 bg-background/60 p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={kindTone(transaction.kind)}>{kindLabel(transaction.kind)}</Badge>
                              <span className="text-sm text-muted-foreground">{linkedSection?.name ?? "No section"}</span>
                            </div>
                            <p className="text-sm text-foreground">{transaction.note || "No note"}</p>
                            <p className="text-xs text-muted-foreground">{new Date(transaction.occurred_at).toLocaleString()}</p>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-semibold">{formatCurrency(transaction.amount_cop)}</div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="ml-auto mt-2"
                              onClick={() => deleteTransaction(transaction.id)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>
        ) : null}

        {activeTab === "year" ? (
          <Card className="border border-border/60 bg-card/90 shadow-sm ring-1 ring-border/40">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                <BarChart3 className="h-5 w-5 text-primary" />
                {selectedYear} overview
              </CardTitle>
              <CardDescription>Monthly totals for salary, spending, and savings in the selected year.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <YearMetric label="Salary" value={formatCurrency(yearTotals.salary_cop)} />
                <YearMetric label="Spent" value={formatCurrency(yearTotals.spent_cop)} />
                <YearMetric label="Saved" value={formatCurrency(yearTotals.saved_cop)} />
                <YearMetric label="Transfers" value={formatCurrency(yearTotals.transfer_cop)} />
                <YearMetric label="Adjustments" value={formatCurrency(yearTotals.adjustment_cop)} />
              </div>

              <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                {yearSummary.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                    No saved months yet for {selectedYear}.
                  </div>
                ) : (
                  yearSummary.map((month) => (
                    <div key={month.month} className="rounded-lg border border-border/60 bg-background/60 p-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">{formatMonthLabel(month.month.slice(0, 7))}</p>
                          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Annual month</p>
                        </div>
                        <Badge variant="outline">
                          {formatCurrency(month.salary_cop)}
                        </Badge>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                        <YearStat label="Spent" value={formatCurrency(month.spent_cop)} />
                        <YearStat label="Saved" value={formatCurrency(month.saved_cop)} />
                        <YearStat label="Transfers" value={formatCurrency(month.transfer_cop)} />
                        <YearStat label="Adjustments" value={formatCurrency(month.adjustment_cop)} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <nav className="fixed inset-x-3 bottom-3 z-30 md:hidden">
        <TabsList className="grid h-auto w-full grid-cols-4 gap-1 rounded-3xl border border-border/60 bg-card/90 p-1.5 shadow-2xl shadow-black/10 ring-1 ring-border/40 backdrop-blur-xl pb-[calc(env(safe-area-inset-bottom)+0.25rem)]">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <TabsTrigger
                key={item.key}
                value={item.key}
                className="flex h-16 flex-col items-center justify-center gap-1 rounded-2xl text-[10px] leading-none data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </nav>
      </main>
    </Tabs>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  helper,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <Card className="border border-border/60 bg-card/90 shadow-sm ring-1 ring-border/40">
      <CardContent className="flex items-start justify-between gap-4 p-4">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold">{value}</p>
          <p className="mt-2 text-xs text-muted-foreground">{helper}</p>
        </div>
        <div className="rounded-xl bg-primary/10 p-2 text-primary ring-1 ring-inset ring-primary/10">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/60 px-4 py-3 text-sm shadow-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function YearMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/60 p-4 shadow-sm">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-semibold">{value}</p>
    </div>
  );
}

function YearStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-card/90 p-3 text-sm shadow-sm">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}
