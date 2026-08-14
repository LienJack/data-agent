"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function AccountControls() {
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
      className="rounded-lg border border-[var(--color-border-default)] bg-white px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] disabled:opacity-50"
    >
      {pending ? "正在退出…" : "退出登录"}
    </button>
  );
}
