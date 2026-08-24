"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ChevronLeft,
  ChevronRight,
  Save,
  X,
  Columns3,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Position, ContractBalance } from "./types";
import { formatPrice, formatPriceFull } from "./helpers";

// ========== Constants ==========

const PAGE_SIZE = 20;
const STORAGE_KEY = "positions-col-visibility";

// Column definitions — single source of truth for ordering, labels, and defaults
const ALL_COLUMNS = [
  { key: "posNum",         label: "№",             pinned: "left",  defaultVisible: true,  responsive: "always"  },
  { key: "name",           label: "Наименование",   pinned: "left",  defaultVisible: true,  responsive: "always"  },
  { key: "characteristics",label: "Характеристики",pinned: null,   defaultVisible: true,  responsive: "md"     },
  { key: "unit",           label: "Ед.изм.",       pinned: null,   defaultVisible: true,  responsive: "always"  },
  { key: "plan",           label: "План",          pinned: null,   defaultVisible: true,  responsive: "always"  },
  { key: "price",          label: "Цена",          pinned: null,   defaultVisible: true,  responsive: "always"  },
  { key: "nds",            label: "НДС",           pinned: null,   defaultVisible: true,  responsive: "md"     },
  { key: "sum",            label: "Сумма",         pinned: null,   defaultVisible: true,  responsive: "always"  },
  { key: "country",        label: "Страна",        pinned: null,   defaultVisible: true,  responsive: "md"     },
  { key: "ktru",           label: "КТРУ",          pinned: null,   defaultVisible: true,  responsive: "lg"     },
  { key: "ordered",        label: "Заказано",      pinned: null,   defaultVisible: true,  responsive: "md"     },
  { key: "received",       label: "Получено",      pinned: null,   defaultVisible: true,  responsive: "md"     },
  { key: "shipped",        label: "Отгружено",     pinned: null,   defaultVisible: true,  responsive: "md"     },
  { key: "remaining",      label: "Остаток",       pinned: null,   defaultVisible: true,  responsive: "md"     },
] as const;

type ColKey = (typeof ALL_COLUMNS)[number]["key"];

// Columns that require balance data (hidden when no balance)
const BALANCE_COLUMNS: ReadonlySet<ColKey> = new Set(["ordered", "received", "shipped", "remaining"]);

// Default visibility map from column definitions
const DEFAULT_VISIBILITY: Record<ColKey, boolean> = Object.fromEntries(
  ALL_COLUMNS.map((c) => [c.key, c.defaultVisible])
) as Record<ColKey, boolean>;

// ========== Helpers ==========

/** Load column visibility from localStorage */
function loadVisibility(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Save column visibility to localStorage */
function saveVisibility(vis: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(vis));
  } catch {
    // localStorage full or unavailable — ignore
  }
}

/** Truncate text with ellipsis, preserving safe display */
function truncate(str: string, maxLen: number): string {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "…";
}

/** Memoized responsive check for column visibility */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

// ========== Components ==========

/** Tooltip-wrapped cell value with comment indicator */
function CommentCell({
  value,
  comment,
  className,
}: {
  value: string;
  comment?: string;
  className?: string;
}) {
  if (!comment) {
    return <span className={className}>{value}</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex items-center gap-1 cursor-default", className)}>
          {value}
          <MessageSquare className="size-3 shrink-0 text-muted-foreground" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <p className="font-medium text-xs mb-1">Комментарий:</p>
        <p className="text-xs whitespace-pre-wrap break-words">{comment}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// ========== Main Component ==========

interface ContractPositionsTabProps {
  positions: Position[];
  balance?: ContractBalance | null;
  canEdit?: boolean;
  contractId?: string;
  onPositionsSaved?: () => void;
}

export function ContractPositionsTab({
  positions,
  balance,
  canEdit,
  contractId,
  onPositionsSaved,
}: ContractPositionsTabProps) {
  // Pagination
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(positions.length / PAGE_SIZE));
  const pagePositions = positions.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Reset page when positions change
  if (page >= totalPages) setPage(0);

  // Editing state
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<Record<string, Record<string, string>>>({});
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // Column visibility (persisted to localStorage)
  const [visibility, setVisibility] = useState<Record<string, boolean>>(() => ({
    ...DEFAULT_VISIBILITY,
    ...loadVisibility(),
  }));

  // Responsive breakpoints
  const isMd = useMediaQuery("(min-width: 768px)");
  const isLg = useMediaQuery("(min-width: 1024px)");

  // Check if any position has balance data
  const hasBalanceData = positions.some((p) => p.orderedQty !== undefined);

  // Computed visible columns considering both user preference + responsive + balance
  const visibleColumns = useMemo(() => {
    return ALL_COLUMNS.filter((col) => {
      // User hidden
      if (visibility[col.key] === false) return false;
      // Responsive: hide if breakpoint not met
      if (col.responsive === "md" && !isMd) return false;
      if (col.responsive === "lg" && !isLg) return false;
      // Balance columns: hide if no balance data
      if (BALANCE_COLUMNS.has(col.key) && !hasBalanceData) return false;
      return true;
    });
  }, [visibility, isMd, isLg, hasBalanceData]);

  // Toggle column visibility
  const toggleColumn = useCallback((key: string) => {
    setVisibility((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveVisibility(next);
      return next;
    });
  }, []);

  // Toggle row expansion for characteristics
  const toggleRow = useCallback((id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Start editing all positions
  function startEditing() {
    const data: Record<string, Record<string, string>> = {};
    for (const pos of positions) {
      data[pos.id] = {
        name: pos.name || "",
        characteristics: pos.characteristics || "",
        unit: pos.unit || "",
        plan: String(pos.plan ?? ""),
        price: String(pos.price ?? ""),
        nds: pos.nds || "",
        country: pos.country || "",
        ktru: pos.ktru || "",
      };
    }
    setEditData(data);
    setEditing(true);
    setExpandedRows(new Set(positions.map((p) => p.id)));
  }

  // Cancel editing
  function cancelEditing() {
    setEditing(false);
    setEditData({});
    setExpandedRows(new Set());
  }

  // Save all positions
  async function savePositions() {
    if (!contractId) return;
    setSaving(true);
    try {
      const payload = positions.map((pos) => {
        const d = editData[pos.id] || {};
        const plan = parseFloat(d.plan) || 0;
        const price = parseFloat(d.price) || 0;
        const sum = plan * price;
        return {
          id: pos.id,
          name: d.name || pos.name,
          characteristics: d.characteristics ?? pos.characteristics,
          unit: d.unit || pos.unit,
          plan: plan.toFixed(2),
          price: d.price || String(pos.price ?? "0"),
          nds: d.nds || pos.nds,
          country: d.country || pos.country,
          ktru: d.ktru || pos.ktru || null,
          sum: sum.toFixed(2),
        };
      });

      const res = await fetch(`/api/contracts/${contractId}/positions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positions: payload }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Ошибка сохранения");
      }

      toast.success("Позиции обновлены");
      setEditing(false);
      setEditData({});
      onPositionsSaved?.();
    } catch (err: any) {
      toast.error(err.message || "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  // Field accessor
  function getField(pos: Position, field: string): string {
    if (editing) {
      return editData[pos.id]?.[field] ?? String(pos[field as keyof Position] ?? "");
    }
    return String(pos[field as keyof Position] ?? "");
  }

  // Auto-calculated sum (always 2 decimal places)
  function calcSum(pos: Position): string {
    if (editing) {
      const plan = parseFloat(editData[pos.id]?.plan || "0") || 0;
      const price = parseFloat(editData[pos.id]?.price || "0") || 0;
      return (plan * price).toFixed(2);
    }
    return String(pos.sum ?? 0);
  }

  // Helper: is column visible by key
  const isColVisible = useCallback(
    (key: ColKey) => visibleColumns.some((c) => c.key === key),
    [visibleColumns]
  );

  // ========== Render ==========

  return (
    <div className="space-y-4">
      {/* Balance summary card */}
      {balance && balance.contractTotal > 0 && (
        <div
          className={cn(
            "grid grid-cols-3 gap-4 p-4 rounded-lg border",
            balance.remainingSum <= 0
              ? "border-destructive/50 bg-destructive/5"
              : balance.remainingSum < balance.contractTotal * 0.1
                ? "border-amber-300 bg-amber-50/50"
                : "border-border bg-muted/30"
          )}
        >
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Сумма контракта</p>
            <p className="text-sm font-bold mt-0.5">{formatPrice(balance.contractTotal)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Заказано</p>
            <p className="text-sm font-bold mt-0.5">{formatPrice(balance.orderedSum)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Остаток</p>
            <p
              className={cn(
                "text-sm font-bold mt-0.5",
                balance.remainingSum <= 0
                  ? "text-destructive"
                  : balance.remainingSum < balance.contractTotal * 0.1
                    ? "text-amber-600"
                    : "text-emerald-600"
              )}
            >
              {formatPrice(balance.remainingSum)}
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {positions.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              Позиции контракта не загружены
            </div>
          ) : (
            <div>
              {/* Toolbar: edit controls + column visibility */}
              <div className="flex items-center justify-between gap-2 px-4 py-2 border-b bg-muted/30">
                <div className="flex gap-2">
                  {canEdit &&
                    (!editing ? (
                      <Button variant="outline" size="sm" onClick={startEditing}>
                        Редактировать
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" onClick={savePositions} disabled={saving}>
                          <Save className="size-3.5 mr-1" />
                          {saving ? "Сохранение..." : "Сохранить"}
                        </Button>
                        <Button variant="outline" size="sm" onClick={cancelEditing} disabled={saving}>
                          <X className="size-3.5 mr-1" />
                          Отмена
                        </Button>
                      </>
                    ))}
                </div>

                {/* Column visibility dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="ml-auto">
                      <Columns3 className="size-4 mr-1" />
                      Колонки
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    {ALL_COLUMNS.map((col) => {
                      const disabled =
                        (BALANCE_COLUMNS.has(col.key) && !hasBalanceData) ||
                        (col.responsive === "md" && !isMd) ||
                        (col.responsive === "lg" && !isLg);
                      const checked = disabled ? false : (visibility[col.key] !== false);
                      return (
                        <DropdownMenuCheckboxItem
                          key={col.key}
                          checked={checked}
                          disabled={disabled}
                          onCheckedChange={() => toggleColumn(col.key)}
                          className="text-xs"
                        >
                          {col.label}
                          {disabled && (
                            <span className="ml-auto text-[10px] text-muted-foreground">
                              {BALANCE_COLUMNS.has(col.key) && !hasBalanceData
                                ? "нет данных"
                                : col.responsive === "md"
                                  ? "<768px"
                                  : col.responsive === "lg"
                                    ? "<1024px"
                                    : ""}
                            </span>
                          )}
                        </DropdownMenuCheckboxItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <Table className="w-full text-sm">
                  <TableHeader>
                    <TableRow>
                      {visibleColumns.map((col) => (
                        <TableHead
                          key={col.key}
                          className={cn(
                            col.key === "posNum" && "w-8 text-center px-1 sticky left-0 bg-background z-10",
                            col.key === "name" && "min-w-[200px] max-w-[320px] sticky left-8 bg-background z-10",
                            col.key === "characteristics" && "min-w-[160px] max-w-[260px]",
                            col.key === "unit" && "w-16 text-center px-1",
                            col.key === "ktru" && "w-24 px-1",
                            col.key === "plan" && "w-20 text-right px-1",
                            col.key === "price" && "w-40 text-right px-1",
                            col.key === "nds" && "w-16 text-center px-1",
                            col.key === "sum" && "w-28 text-right px-1",
                            col.key === "country" && "w-20 px-1",
                            (col.key === "ordered" || col.key === "received" || col.key === "shipped") && "w-20 text-right px-1",
                            col.key === "remaining" && "w-20 text-right px-1"
                          )}
                        >
                          {col.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagePositions.map((pos) => {
                      const remaining = pos.remainingQty ?? Number(pos.plan) ?? 0;
                      const plan = Number(pos.plan) ?? 0;
                      const hasChars = pos.characteristics || (editing && editData[pos.id]?.characteristics);
                      const isExpanded = expandedRows.has(pos.id);

                      return (
                        <TableRow key={pos.id}>
                          {/* № — pinned left */}
                          {isColVisible("posNum") && (
                            <TableCell className="text-center text-muted-foreground sticky left-0 bg-background z-10">
                              {pos.positionNumber ?? "—"}
                            </TableCell>
                          )}

                          {/* Наименование — pinned left */}
                          {isColVisible("name") && (
                            <TableCell className="min-w-0 sticky left-8 bg-background z-10">
                              {editing ? (
                                <Input
                                  type="text"
                                  value={getField(pos, "name")}
                                  onChange={(e) =>
                                    setEditData((prev) => ({
                                      ...prev,
                                      [pos.id]: { ...prev[pos.id], name: e.target.value },
                                    }))
                                  }
                                  className="h-7 text-sm"
                                />
                              ) : (
                                <span className="font-medium text-sm whitespace-normal break-words">
                                  {getField(pos, "name") || "—"}
                                </span>
                              )}
                            </TableCell>
                          )}

                          {/* Характеристики — inline truncated + tooltip */}
                          {isColVisible("characteristics") && (
                            <TableCell className="min-w-0 max-w-[200px]">
                              {editing ? (
                                <Textarea
                                  value={editData[pos.id]?.characteristics || ""}
                                  onChange={(e) =>
                                    setEditData((prev) => ({
                                      ...prev,
                                      [pos.id]: { ...prev[pos.id], characteristics: e.target.value },
                                    }))
                                  }
                                  className="min-h-[48px] text-xs"
                                  rows={2}
                                />
                              ) : hasChars ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <p
                                      className={cn(
                                        "text-xs text-muted-foreground cursor-default break-words",
                                        expandedRows.has(pos.id)
                                          ? "whitespace-pre-wrap"
                                          : "line-clamp-2"
                                      )}
                                      onClick={() => toggleRow(pos.id)}
                                    >
                                      {pos.characteristics}
                                    </p>
                                  </TooltipTrigger>
                                  <TooltipContent side="bottom" className="max-w-sm max-h-48 overflow-y-auto">
                                    <p className="text-xs whitespace-pre-wrap break-words">{pos.characteristics}</p>
                                  </TooltipContent>
                                </Tooltip>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          )}

                          {/* Ед.изм. */}
                          {isColVisible("unit") && (
                            <TableCell className="text-center px-1">
                              {editing ? (
                                <Input
                                  type="text"
                                  value={getField(pos, "unit")}
                                  onChange={(e) =>
                                    setEditData((prev) => ({
                                      ...prev,
                                      [pos.id]: { ...prev[pos.id], unit: e.target.value },
                                    }))
                                  }
                                  className="h-7 text-xs text-center w-16"
                                />
                              ) : (
                                pos.unit || "—"
                              )}
                            </TableCell>
                          )}

                          {/* План */}
                          {isColVisible("plan") && (
                            <TableCell className="text-right tabular-nums px-1">
                              {editing ? (
                                <Input
                                  type="number"
                                  step="any"
                                  value={getField(pos, "plan")}
                                  onChange={(e) =>
                                    setEditData((prev) => ({
                                      ...prev,
                                      [pos.id]: { ...prev[pos.id], plan: e.target.value },
                                    }))
                                  }
                                  className="h-7 text-xs text-right w-20"
                                />
                              ) : (
                                plan.toFixed(2)
                              )}
                            </TableCell>
                          )}

                          {/* Цена — full precision, no trailing zeros */}
                          {isColVisible("price") && (
                            <TableCell className="text-right tabular-nums px-1">
                              {editing ? (
                                <Input
                                  type="number"
                                  step="any"
                                  value={getField(pos, "price")}
                                  onChange={(e) =>
                                    setEditData((prev) => ({
                                      ...prev,
                                      [pos.id]: { ...prev[pos.id], price: e.target.value },
                                    }))
                                  }
                                  className="h-7 text-xs text-right w-28"
                                />
                              ) : (
                                <span className="cursor-default">{formatPriceFull(pos.price)}</span>
                              )}
                            </TableCell>
                          )}

                          {/* НДС */}
                          {isColVisible("nds") && (
                            <TableCell className="text-center px-1">
                              {editing ? (
                                <Input
                                  type="text"
                                  value={getField(pos, "nds")}
                                  onChange={(e) =>
                                    setEditData((prev) => ({
                                      ...prev,
                                      [pos.id]: { ...prev[pos.id], nds: e.target.value },
                                    }))
                                  }
                                  className="h-7 text-xs text-center w-16"
                                />
                              ) : (
                                pos.nds || "—"
                              )}
                            </TableCell>
                          )}

                          {/* Сумма */}
                          {isColVisible("sum") && (
                            <TableCell className="text-right tabular-nums font-medium px-1">
                              {editing ? formatPrice(calcSum(pos)) : formatPrice(pos.sum)}
                            </TableCell>
                          )}

                          {/* Страна */}
                          {isColVisible("country") && (
                            <TableCell className="px-1">
                              {editing ? (
                                <Input
                                  type="text"
                                  value={getField(pos, "country")}
                                  onChange={(e) =>
                                    setEditData((prev) => ({
                                      ...prev,
                                      [pos.id]: { ...prev[pos.id], country: e.target.value },
                                    }))
                                  }
                                  className="h-7 text-xs w-20"
                                />
                              ) : (
                                pos.country || "—"
                              )}
                            </TableCell>
                          )}

                          {/* КТРУ */}
                          {isColVisible("ktru") && (
                            <TableCell className="text-xs text-muted-foreground px-1">
                              {editing ? (
                                <Input
                                  type="text"
                                  value={getField(pos, "ktru")}
                                  onChange={(e) =>
                                    setEditData((prev) => ({
                                      ...prev,
                                      [pos.id]: { ...prev[pos.id], ktru: e.target.value },
                                    }))
                                  }
                                  className="h-7 text-xs"
                                />
                              ) : (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="cursor-default">{pos.ktru || "—"}</span>
                                  </TooltipTrigger>
                                  {pos.ktru && (
                                    <TooltipContent side="top">
                                      <p className="text-xs font-mono">{pos.ktru}</p>
                                    </TooltipContent>
                                  )}
                                </Tooltip>
                              )}
                            </TableCell>
                          )}

                          {/* Заказано — supplier balance with comment tooltip */}
                          {isColVisible("ordered") && hasBalanceData && (
                            <TableCell className="text-right tabular-nums px-1">
                              <CommentCell
                                value={Number(pos.orderedQty ?? 0).toFixed(2)}
                                comment={pos.orderedComment}
                                className={pos.orderedQty! > 0 ? "text-blue-600" : ""}
                              />
                            </TableCell>
                          )}

                          {/* Получено — received from supplier with comment tooltip */}
                          {isColVisible("received") && hasBalanceData && (
                            <TableCell className="text-right tabular-nums px-1">
                              <CommentCell
                                value={Number(pos.receivedQty ?? 0).toFixed(2)}
                                comment={pos.receivedComment}
                                className={pos.receivedQty! > 0 ? "text-cyan-600" : ""}
                              />
                            </TableCell>
                          )}

                          {/* Отгружено — shipped with comment tooltip */}
                          {isColVisible("shipped") && hasBalanceData && (
                            <TableCell className="text-right tabular-nums px-1">
                              <CommentCell
                                value={Number(pos.shippedQty ?? 0).toFixed(2)}
                                comment={pos.shippedComment}
                                className={pos.shippedQty! > 0 ? "text-emerald-600" : ""}
                              />
                            </TableCell>
                          )}

                          {/* Остаток */}
                          {isColVisible("remaining") && hasBalanceData && (
                            <TableCell
                              className={cn(
                                "text-right tabular-nums font-medium px-1",
                                remaining <= 0
                                  ? "text-destructive"
                                  : remaining < plan * 0.1
                                    ? "text-amber-600"
                                    : ""
                              )}
                            >
                              {remaining.toFixed(2)}
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}

                    {/* Totals row */}
                    {positions.length > 0 && (
                      <TableRow className="bg-muted/50 font-medium">
                        {/* Count visible columns before plan for colSpan */}
                        <TableCell
                          colSpan={
                            visibleColumns.filter(
                              (c) => ["posNum", "name", "characteristics", "unit", "ktru"].includes(c.key)
                            ).length
                          }
                          className="text-right px-1"
                        >
                          Итого:
                        </TableCell>
                        {/* План total */}
                        {isColVisible("plan") && (
                          <TableCell className="text-right tabular-nums px-1">
                            {positions.reduce((acc, p) => acc + (Number(p.plan) ?? 0), 0).toFixed(2)}
                          </TableCell>
                        )}
                        {/* Skip price — no meaningful total for price */}
                        {isColVisible("price") && <TableCell />}
                        {/* Сумма total */}
                        {isColVisible("sum") && (
                          <TableCell className="text-right tabular-nums px-1">
                            {formatPrice(
                              editing
                                ? positions.reduce((acc, p) => {
                                    const pVal = parseFloat(editData[p.id]?.plan || "0") || 0;
                                    const prVal = parseFloat(editData[p.id]?.price || "0") || 0;
                                    return acc + pVal * prVal;
                                  }, 0)
                                : positions.reduce((acc, p) => acc + (Number(p.sum) || 0), 0)
                            )}
                          </TableCell>
                        )}
                        {/* Skip country, nds in totals */}
                        {isColVisible("country") && <TableCell />}
                        {isColVisible("nds") && <TableCell />}
                        {/* Balance totals */}
                        {isColVisible("ordered") && hasBalanceData && (
                          <TableCell className="text-right tabular-nums px-1">
                            {positions.some((p) => p.orderedQty !== undefined)
                              ? positions.reduce((acc, p) => acc + (p.orderedQty ?? 0), 0).toFixed(2)
                              : "—"}
                          </TableCell>
                        )}
                        {isColVisible("received") && hasBalanceData && (
                          <TableCell className="text-right tabular-nums px-1">
                            {positions.some((p) => p.receivedQty !== undefined)
                              ? positions.reduce((acc, p) => acc + (p.receivedQty ?? 0), 0).toFixed(2)
                              : "—"}
                          </TableCell>
                        )}
                        {isColVisible("shipped") && hasBalanceData && (
                          <TableCell className="text-right tabular-nums px-1">
                            {positions.some((p) => p.shippedQty !== undefined)
                              ? positions.reduce((acc, p) => acc + (p.shippedQty ?? 0), 0).toFixed(2)
                              : "—"}
                          </TableCell>
                        )}
                        {isColVisible("remaining") && hasBalanceData && (
                          <TableCell className="text-right tabular-nums px-1">
                            {positions.some((p) => p.remainingQty !== undefined)
                              ? positions.reduce((acc, p) => acc + (p.remainingQty ?? 0), 0).toFixed(2)
                              : "—"}
                          </TableCell>
                        )}
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <p className="text-xs text-muted-foreground">
                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, positions.length)} из{" "}
                    {positions.length}
                  </p>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8"
                      disabled={page === 0}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                    {Array.from({ length: totalPages }, (_, i) => (
                      <Button
                        key={i}
                        variant={i === page ? "default" : "outline"}
                        size="icon"
                        className="size-8"
                        onClick={() => setPage(i)}
                      >
                        {i + 1}
                      </Button>
                    )).slice(Math.max(0, page - 2), Math.min(totalPages, page + 3))}
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
