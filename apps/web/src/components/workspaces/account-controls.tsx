"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useWorkspaceI18n } from "@/i18n";
import { authClient } from "@/lib/auth-client";

export function AccountControls() {
  const { t } = useWorkspaceI18n();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void authClient.signOut().finally(() => {
          router.replace("/login");
          router.refresh();
        });
      }}
      className="control-pressable rounded-[var(--radius-control)] border border-[var(--color-border-default)] bg-white px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] shadow-[inset_0_1px_0_rgb(255_255_255_/_0.8)] hover:bg-[var(--color-bg-overlay)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
    >
      {pending ? t("workspace.signingOut") : t("workspace.signOut")}
    </button>
  );
}
