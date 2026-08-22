# Technical Design

运营页面消费统一 ListRow、CommandBar、SplitView 和状态 primitive。Settings 使用左侧分类/右侧内容的 responsive layout；Tests 先做组件拆分再改视觉，避免继续扩大单文件。Dark theme 通过 `color-scheme` 与 token override 实现，业务状态色单独校验。
