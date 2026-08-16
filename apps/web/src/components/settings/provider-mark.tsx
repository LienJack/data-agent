import type { ModelVendorId } from "@data-agent/contracts";
import Image from "next/image";
import { getModelProviderCatalogItem } from "@/lib/model-provider-catalog";
import { cn } from "@/lib/utils";

interface ProviderMarkProps {
  vendorId: ModelVendorId;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASSES = {
  sm: "h-7 w-7 rounded-md text-[9px]",
  md: "h-9 w-9 rounded-lg text-[11px]",
  lg: "h-11 w-11 rounded-xl text-xs",
} as const;

const ICON_SIZE_CLASSES = {
  sm: "h-[18px] w-[18px]",
  md: "h-6 w-6",
  lg: "h-7 w-7",
} as const;

const ICON_PIXEL_SIZE = {
  sm: 18,
  md: 24,
  lg: 28,
} as const;

export function ProviderMark({ vendorId, size = "md", className }: ProviderMarkProps) {
  const item = getModelProviderCatalogItem(vendorId);

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-bold tracking-[-0.04em] shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.24)]",
        SIZE_CLASSES[size],
        className,
      )}
      style={{ backgroundColor: item.markBackground, color: item.markForeground }}
    >
      {item.iconPath ? (
        <Image
          src={item.iconPath}
          alt=""
          width={ICON_PIXEL_SIZE[size]}
          height={ICON_PIXEL_SIZE[size]}
          unoptimized
          className={cn(
            "object-contain",
            ICON_SIZE_CLASSES[size],
            item.iconTreatment === "invert" && "brightness-0 invert",
          )}
        />
      ) : (
        item.mark
      )}
    </span>
  );
}
