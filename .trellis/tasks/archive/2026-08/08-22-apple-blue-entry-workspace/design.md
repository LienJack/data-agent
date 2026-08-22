# Technical Design

入口页消费 foundation token。登录继续使用本地 client state；Workspace 选择保持 server component。首页复用现有 authority 投影与导航，不新增假数据；若缺少“最近访问”持久化证据，则以可访问 Workspace 列表和真实角色信息呈现，不伪造时间。
