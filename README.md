# 学习通 AI 独立作业助手 V1.0

基于 [March-OwO/Xuexitong-LLM-Assistant](https://github.com/March-OwO/Xuexitong-LLM-Assistant) 的 MIT 开源项目进行二次开发，专门处理老师在课程中单独布置的学习通作业。

V1.0 只负责识别、生成和填写答案。脚本不会自动开始、不会自动提交，也不会处理视频、签到、章节测验或考试。请只在课程规则允许使用 AI 的情况下使用，并在提交前逐题检查。

## 安装

1. 安装 Tampermonkey 浏览器扩展。
2. 打开仓库根目录的 [`chaoxing-homework-assistant.user.js`](./chaoxing-homework-assistant.user.js)。
3. 在 GitHub 文件页点击 Raw，Tampermonkey 会显示安装页面。
4. 安装 V1.0 后，禁用旧版“学习通AI学习助手”，避免两个脚本同时运行。
5. 登录学习通并进入某一份独立作业页面。

V1.0 识别以下路径：

- `/mooc2/work/dowork`
- `/mooc-ans/mooc2/work/dowork`
- `/mooc2-ans/mooc2/work/dowork`
- `/work/doHomeWorkNew` 及其 `mooc-ans`、`mooc2-ans` 变体

章节学习页、考试页、已批阅页面和其他课程任务不会启动本助手。

## 使用

1. 在作业页右侧打开“API 设置”。
2. 填入自己的 DeepSeek API Key 并保存。
3. 可先点击“测试连接”。连接测试会产生一次很小的 API 请求。
4. 点击“开始答题”。
5. 随时可以暂停、继续或停止。
6. 填写完成后人工检查答案，再自行点击学习通原生提交按钮。

默认不会覆盖页面中已有答案。只有用户勾选“重新填写并覆盖已有答案”后，才会尝试重新填写。

## 功能

- 手动开始，防止页面加载后自动答题
- 单选、多选、判断、填空、简答题识别与填写
- 题目 ID、题型和答案数量校验，避免答案错位
- DeepSeek 结构化 JSON 答案
- 45 秒超时、网络错误与 5xx 重试、429 限流退避
- 暂停后不再发起新请求或填写答案
- 停止时中止当前请求，后续题目不再处理
- 重复点击开始不会创建多个任务
- 进度、成功数、失败数和运行日志
- API Key 仅存放在 Tampermonkey 本地存储中，不写入仓库或日志

## DeepSeek 配置

- API：`https://api.deepseek.com/chat/completions`
- 模型：`deepseek-flash`
- 鉴权：用户自己的 API Key

脚本只允许连接 `api.deepseek.com`，不支持第三方中转站或多模型切换。详细说明见 [`docs/DeepSeek_API配置.md`](./docs/DeepSeek_API配置.md)。

## 项目结构

```text
├── chaoxing-homework-assistant.user.js       # 构建后的可安装脚本
├── chaoxing-ai-llm.user.js                   # 上游原脚本，保留用于对照，不是 V1.0 安装入口
├── src/
│   └── chaoxing-homework-assistant.user.js   # V1.0 完整源码
├── scripts/
│   ├── build.js                              # 无依赖构建脚本
│   └── test-server.js                        # 仅用于本地模拟页
├── test/
│   ├── assistant.test.js                     # Node 自动化测试
│   └── mock-homework.html                    # 本地模拟作业页面
├── docs/
│   ├── DeepSeek_API配置.md
│   └── 测试报告_20261104.md
├── LICENSE                                   # 原 MIT License
└── package.json
```

## 开发与测试

无需安装第三方依赖，需要 Node.js 18 或更高版本：

```bash
npm run build
npm run check
npm test
```

本地模拟页：

```bash
node scripts/test-server.js
```

然后打开 `http://127.0.0.1:41735/test/mock-homework.html`。模拟页使用本地假接口，不会调用 DeepSeek，也不会连接真实学习通。

## 测试状态

- Node 自动化测试：19/19 通过
- 语法检查：通过
- 本地模拟页文件及 HTTP 访问：通过
- 浏览器可视化验收：真实独立作业页面中悬浮窗正常显示
- 真实学习通页面：17 道单选题提取准确；已用固定测试值完成单题填写并刷新恢复，确认未自动保存；未执行 AI 请求、暂存或提交
- 真实 DeepSeek Key：未使用，未产生真实 API 费用

完整测试结果和限制见 [`docs/测试报告_20261104.md`](./docs/测试报告_20261104.md)。

## 已知限制

- 学习通可能存在学校定制 DOM；未见过的页面结构会记录失败并跳过，不会猜测元素。
- 选择题依赖页面中可定位的选项容器或表单控件；真实页面仍需低风险验证。
- 图片题不支持。
- 停止请求依赖 Tampermonkey 对 `GM_xmlhttpRequest().abort()` 的支持。
- 仓库保留上游原脚本用于审计与对照；安装时只安装 `chaoxing-homework-assistant.user.js`。

## 许可证

本项目继续使用 MIT License，并保留原作者版权声明。详见 [`LICENSE`](./LICENSE)。
