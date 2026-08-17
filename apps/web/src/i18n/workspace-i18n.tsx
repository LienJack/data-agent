"use client";

import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { type MessageKey, messagesByLocale, type WorkspaceLocale } from "./messages";

const LOCALE_STORAGE_KEY = "data-agent.interface-locale";

interface WorkspaceI18nValue {
  readonly locale: WorkspaceLocale;
  readonly setLocale: (locale: WorkspaceLocale) => void;
  readonly t: (key: MessageKey) => string;
}

const defaultValue: WorkspaceI18nValue = {
  locale: "zh-CN",
  setLocale: () => undefined,
  t: (key) => messagesByLocale["zh-CN"][key],
};

const WorkspaceI18nContext = createContext<WorkspaceI18nValue>(defaultValue);

export function WorkspaceI18nProvider({
  children,
  initialLocale = "zh-CN",
}: {
  readonly children: ReactNode;
  readonly initialLocale?: WorkspaceLocale;
}) {
  const [locale, setLocaleState] = useState<WorkspaceLocale>(initialLocale);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (stored === "zh-CN" || stored === "en-US") setLocaleState(stored);
    } catch {
      // A blocked display preference must never block the workspace.
    }
  }, []);

  const value = useMemo<WorkspaceI18nValue>(
    () => ({
      locale,
      setLocale: (nextLocale) => {
        setLocaleState(nextLocale);
        try {
          window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
        } catch {
          // The selected locale remains valid for the current document.
        }
      },
      t: (key) => messagesByLocale[locale][key],
    }),
    [locale],
  );

  return <WorkspaceI18nContext.Provider value={value}>{children}</WorkspaceI18nContext.Provider>;
}

export function useWorkspaceI18n(): WorkspaceI18nValue {
  return useContext(WorkspaceI18nContext);
}
