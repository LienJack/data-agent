# U3 设计

- Model availability 只由 provider/model binding、服务端 credential、deployment 和技术预算决定。
- Test Center/Semantic Candidate 共用非商业 model runtime，不读取 price/fx/billing state。
- Usage receipt 只保存 provider reported token、latency、outcome、tool calls；商业字段 forbidden。
- 历史认证/调用记录不得重新接入活动 readiness。
