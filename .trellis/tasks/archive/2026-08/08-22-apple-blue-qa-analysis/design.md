# Technical Design

保持现有 `qa-page-frame` geometry 和 Inspector concession 算法。视觉层只调整 Chrome、阅读列、活动 disclosure 与 transition。Framer Motion 仅用于可打断 panel/layout transition；运行事件的实时变化仍由现有 store 驱动。
