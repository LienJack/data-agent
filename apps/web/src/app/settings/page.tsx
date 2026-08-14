import { PricingControlPanel } from "@/components/settings/pricing-control-panel";

/**
 * Settings 设置页面 — 模型配置管理。
 *
 * 展示环境系统模型与手工供应商配置。
 * 供应商使用卡片添加，供应商内按模型行选择。
 */
export default function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="workspace-container">
        <div className="workspace-section">
          <PricingControlPanel />
        </div>
      </div>
    </div>
  );
}
