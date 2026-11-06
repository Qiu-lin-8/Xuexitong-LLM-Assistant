# DeepSeek API 配置说明

## 获取与填写

1. 在 DeepSeek 官方开放平台创建 API Key。
2. 进入学习通独立作业页，打开右侧助手面板。
3. 点击“API 设置”，将 Key 填入密码框并保存。
4. 可点击“测试连接”验证配置。

API Key 通过 Tampermonkey 的 `GM_setValue` 保存在当前浏览器的本地扩展存储中。源码、Git 提交、运行日志和测试文件均不包含 Key。

## 配置

- API 地址：`https://api.deepseek.com/chat/completions`
- 默认模型：`deepseek-flash`（界面显示为 DeepSeek Flash V4.1，低成本）
- 可选模型：`deepseek-v4-pro`（更强能力，费用以 DeepSeek 官方计费页为准）
- 请求格式：OpenAI 兼容 Chat Completions
- 超时：45 秒
- 默认最大尝试次数：3 次
- 429：等待后重试
- 5xx 或网络错误：递增等待后重试
- 401/403：直接提示 Key 无效或无权限，不重试

为了减少 Token 消耗，脚本只发送当前题目的题型、题干、选项和填空数量，不上传整份网页 HTML、学习通账号信息或其他题目。

模型通过面板中的下拉框选择，并与 API Key 一起保存在 Tampermonkey 本地存储。脚本只接受上述两个官方模型参数；旧兼容名 `deepseek-v4-flash` 或未知值会回退到默认的 `deepseek-flash`。

## 连接测试

“测试连接”会向 DeepSeek 发送一道固定的简单判断题，因此会产生一次很小的 API 请求。脚本不会在没有用户点击的情况下自行测试，也不会把 Key 输出到日志。

## 安全提醒

- 不要把 API Key 写进脚本源码、README、Issue 或聊天记录。
- 不要把包含 Key 的 Tampermonkey 配置导出后公开。
- 如果怀疑 Key 泄露，请立即到 DeepSeek 控制台撤销并重新生成。
- V1.1 不支持第三方中转站，`@connect` 仅允许 `api.deepseek.com`。
