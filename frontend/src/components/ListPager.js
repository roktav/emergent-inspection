import { useEffect, useMemo, useState } from "react";
import { useT } from "../lib/i18n";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from "./ui/pagination";

export const PAGE_SIZE = 20;

export function formatRange(t, page, pageSize, total) {
  if (!total) return `0 ${t("items")}`;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return t("showing_range")
    .replace("{from}", String(from))
    .replace("{to}", String(to))
    .replace("{total}", String(total));
}

export function totalFromHeader(response, fallback = 0) {
  const raw = response?.headers?.["x-total-count"];
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function pageWindow(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const set = new Set([1, pages, page, page - 1, page + 1]);
  const nums = [...set].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out = [];
  nums.forEach((n) => {
    if (out.length && n - out[out.length - 1] > 1) out.push("ellipsis");
    out.push(n);
  });
  return out;
}

export function useClientPager(rows, { pageSize = PAGE_SIZE, resetKey } = {}) {
  const [page, setPage] = useState(1);
  useEffect(() => {
    if (resetKey === undefined) return;
    setPage(1);
  }, [resetKey]);
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(page, pages);
  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);
  const slice = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, safePage, pageSize]);
  return { page: safePage, setPage, slice, total, pageSize };
}

export function ListPager({ page, pageSize = PAGE_SIZE, total, onPageChange, testId = "list-pager" }) {
  const { t } = useT();
  const pages = Math.max(1, Math.ceil((total || 0) / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), pages);

  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid={testId}>
      <p className="text-sm text-muted-foreground" data-testid={`${testId}-range`}>
        {formatRange(t, safePage, pageSize, total || 0)}
      </p>
      {total > pageSize && (
        <Pagination className="mx-0 w-auto justify-start sm:justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationLink
                size="default"
                className="gap-1 pl-2.5"
                disabled={safePage <= 1}
                onClick={() => onPageChange(safePage - 1)}
                aria-label={t("page_prev")}
                data-testid={`${testId}-prev`}
              >
                {t("page_prev")}
              </PaginationLink>
            </PaginationItem>
            {pageWindow(safePage, pages).map((item, i) => (
              <PaginationItem key={`${item}-${i}`}>
                {item === "ellipsis" ? (
                  <PaginationEllipsis />
                ) : (
                  <PaginationLink
                    isActive={item === safePage}
                    onClick={() => onPageChange(item)}
                    data-testid={`${testId}-page-${item}`}
                  >
                    {item}
                  </PaginationLink>
                )}
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationLink
                size="default"
                className="gap-1 pr-2.5"
                disabled={safePage >= pages}
                onClick={() => onPageChange(safePage + 1)}
                aria-label={t("page_next")}
                data-testid={`${testId}-next`}
              >
                {t("page_next")}
              </PaginationLink>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
