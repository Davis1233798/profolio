"use client";
import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { usePortfolioLocale } from "./portfolio-experience";

export type Option = { value: string; label: string };
export type OperationField = {
  name: string;
  label: string;
  type?: "text" | "number" | "datetime-local";
  min?: number;
  options?: Option[];
  value?: string | number;
  optional?: boolean;
};

export function OperationForm({
  module,
  action,
  title,
  fields,
  onSaved,
}: {
  module: string;
  action: string;
  title: string;
  fields: OperationField[];
  onSaved: () => void;
}) {
  const id = useId();
  const { t } = usePortfolioLocale();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  return (
    <details className="operation-panel" data-operation-panel>
      <summary>
        <span>{t(title)}</span>
        <ChevronDown size={16} />
      </summary>
      <form
        aria-label={t(title)}
        data-operation-form
        className="rounded-xl border border-stone-200 bg-white p-5 space-y-4"
        onSubmit={async event => {
          event.preventDefault();
          setBusy(true);
          setMessage(null);
          const payload: Record<string, unknown> = { action };
          const form = new FormData(event.currentTarget);
          for (const field of fields) {
            const value = form.get(field.name);
            if (value !== "" && value !== null)
              payload[field.name] = field.type === "number" ? Number(value) : value;
          }
          try {
            const response = await fetch(`/api/operations/${module}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            const result: any = await response.json();
            if (!response.ok || !result.success)
              throw new Error(result.error?.message || t("Operation not completed", "操作未完成"));
            setFailed(false);
            setMessage(result.data?.message || t("Saved. Data updated.", "已儲存，資料已更新。"));
            onSaved();
          } catch (error) {
            setFailed(true);
            setMessage(
              error instanceof Error ? error.message : t("Connection failed. Please retry.", "連線失敗，請重試。")
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {fields.map(field => (
          <label key={field.name} htmlFor={`${id}-${field.name}`} className="block text-xs text-stone-600">
            {t(field.label)}
            <span className="block mt-1">
              {field.options ? (
                <select
                  id={`${id}-${field.name}`}
                  name={field.name}
                  required={!field.optional}
                  defaultValue={field.value || ""}
                  className="w-full p-2 border border-stone-300 rounded-lg bg-white"
                >
                  <option value="">{t("Select an option", "請選擇項目")}</option>
                  {field.options.map(option => (
                    <option key={option.value} value={option.value}>
                      {t(option.label)}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`${id}-${field.name}`}
                  name={field.name}
                  type={field.type || "text"}
                  min={field.min}
                  maxLength={field.type === "text" || !field.type ? 250 : undefined}
                  defaultValue={field.value}
                  required={!field.optional}
                  className="w-full p-2 border border-stone-300 rounded-lg"
                />
              )}
            </span>
          </label>
        ))}
        {message && (
          <p
            role={failed ? "alert" : "status"}
            className={`text-xs leading-6 ${failed ? "text-red-700" : "text-emerald-700"}`}
          >
            {message}
          </p>
        )}
        <button disabled={busy} className="rounded-lg bg-primary text-white w-full py-2 text-xs font-medium">
          {busy ? t("Saving…", "儲存中…") : t(title)}
        </button>
      </form>
    </details>
  );
}
