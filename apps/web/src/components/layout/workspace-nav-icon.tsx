import {
  Briefcase,
  ChatCircleDots,
  Database,
  Flask,
  GearSix,
  Graph,
  UsersThree,
} from "@phosphor-icons/react";
import type { WorkspaceNavigationKey } from "@/lib/workspace-navigation";

const icons = {
  qa: ChatCircleDots,
  tests: Flask,
  jobs: Briefcase,
  "data-sources": Database,
  semantic: Graph,
  members: UsersThree,
  "platform-settings": GearSix,
} as const;

export function WorkspaceNavIcon({
  navigationKey,
  size = 18,
}: {
  readonly navigationKey: WorkspaceNavigationKey;
  readonly size?: number;
}) {
  const Icon = icons[navigationKey];
  return <Icon aria-hidden="true" size={size} weight="regular" />;
}
