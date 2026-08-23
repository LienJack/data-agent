# U8 设计

- Controller/reducer 以服务端 revision/event sequence 为唯一状态推进依据；panel 不直接改 server authority。
- Typed editor operations 顺序本地投影，显式 Save 才形成 Candidate Revision，不引入 autosave。
- Explorer 共享组件从 route 文件迁到 `components/semantic/explorer`，Workspace route 直接引用。
- 删除 legacy route 文件和 `next.config.mjs` redirects；框架默认 404 是唯一退役行为。
- 遵循 Data Agent 7/10 密度、light tokens、390px 无横向溢出、原生 disclosure/ARIA。
