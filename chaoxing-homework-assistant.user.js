// ==UserScript==
// @name         学习通 AI 独立作业助手
// @namespace    https://github.com/Qiu-lin-8/Xuexitong-LLM-Assistant
// @version      1.1.0
// @author       March, Qiu-lin-8
// @description  仅处理学习通独立作业：由用户手动启动，使用 DeepSeek 生成并填写答案，绝不自动提交。
// @license      MIT
// @homepageURL  https://github.com/Qiu-lin-8/Xuexitong-LLM-Assistant
// @supportURL   https://github.com/Qiu-lin-8/Xuexitong-LLM-Assistant/issues
// @updateURL    https://raw.githubusercontent.com/Qiu-lin-8/Xuexitong-LLM-Assistant/main/chaoxing-homework-assistant.user.js
// @downloadURL  https://raw.githubusercontent.com/Qiu-lin-8/Xuexitong-LLM-Assistant/main/chaoxing-homework-assistant.user.js
// @match        *://*.chaoxing.com/*
// @match        *://*.edu.cn/*
// @match        *://*.nbdlib.cn/*
// @match        *://*.hnsyu.net/*
// @match        *://*.gdhkmooc.com/*
// @connect      api.deepseek.com
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @run-at       document-end
// ==/UserScript==

(function (global) {
  "use strict";

  const VERSION = "1.1.0";
  const API_URL = "https://api.deepseek.com/chat/completions";
  const MODEL = "deepseek-flash";
  const MODEL_OPTIONS = Object.freeze([
    { value: "deepseek-flash", label: "DeepSeek Flash（V4.1，低成本）" },
    { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro（更强能力）" }
  ]);
  const CONFIG_KEY = "chaoxing_homework_assistant_v1";
  const SUPPORTED_PATHS = new Set([
    "/mooc2/work/dowork",
    "/mooc-ans/mooc2/work/dowork",
    "/mooc2-ans/mooc2/work/dowork",
    "/work/doHomeWorkNew",
    "/mooc-ans/work/doHomeWorkNew",
    "/mooc2-ans/work/doHomeWorkNew"
  ]);

  const TYPE_BY_CODE = {
    "0": "single",
    "1": "multiple",
    "2": "fill",
    "3": "judgment",
    "4": "short",
    "5": "short",
    "6": "short",
    "7": "short"
  };

  class TaskStoppedError extends Error {
    constructor(message = "答题任务已停止") {
      super(message);
      this.name = "TaskStoppedError";
    }
  }

  class TaskController {
    constructor() {
      this.state = "idle";
      this.abortHandlers = new Set();
    }

    start() {
      if (["running", "paused"].includes(this.state)) return false;
      this.state = "running";
      return true;
    }

    pause() {
      if (this.state !== "running") return false;
      this.state = "paused";
      return true;
    }

    resume() {
      if (this.state !== "paused") return false;
      this.state = "running";
      return true;
    }

    stop() {
      if (!["running", "paused"].includes(this.state)) return false;
      this.state = "stopped";
      for (const handler of [...this.abortHandlers]) {
        try { handler(); } catch (_) {}
      }
      this.abortHandlers.clear();
      return true;
    }

    complete() {
      if (this.state !== "stopped") this.state = "completed";
    }

    registerAbort(handler) {
      this.abortHandlers.add(handler);
      return () => this.abortHandlers.delete(handler);
    }

    throwIfStopped() {
      if (this.state === "stopped") throw new TaskStoppedError();
    }

    async checkpoint() {
      this.throwIfStopped();
      while (this.state === "paused") {
        await delay(100);
        this.throwIfStopped();
      }
      this.throwIfStopped();
    }
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isIndependentHomeworkPath(pathname) {
    return SUPPORTED_PATHS.has(String(pathname || "").replace(/\/+$/, ""));
  }

  function normalizeWhitespace(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function stripQuestionPrefix(value) {
    return normalizeWhitespace(value)
      .replace(/^\s*\d+\s*[.、．)]\s*/, "")
      .replace(/^\s*[（(]?\s*(单选题|多选题|判断题|填空题|简答题|名词解释|论述题|计算题)\s*[)）]?\s*/i, "")
      .replace(/^\s*[（(]\s*\d+(?:\.\d+)?\s*分\s*[)）]\s*/, "")
      .trim();
  }

  function inferQuestionType(code, labelText) {
    if (TYPE_BY_CODE[String(code)] != null) return TYPE_BY_CODE[String(code)];
    const label = normalizeWhitespace(labelText);
    if (/多选/.test(label)) return "multiple";
    if (/单选/.test(label)) return "single";
    if (/判断/.test(label)) return "judgment";
    if (/填空/.test(label)) return "fill";
    if (/简答|名词解释|论述|计算/.test(label)) return "short";
    return "unknown";
  }

  function toArray(value) {
    return value ? Array.from(value) : [];
  }

  function safeQuery(root, selector) {
    try { return root && root.querySelector ? root.querySelector(selector) : null; } catch (_) { return null; }
  }

  function safeQueryAll(root, selector) {
    try { return root && root.querySelectorAll ? toArray(root.querySelectorAll(selector)) : []; } catch (_) { return []; }
  }

  function elementText(element) {
    return normalizeWhitespace(element && (element.innerText || element.textContent || ""));
  }

  function optionKeyAt(index) {
    return index >= 0 && index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
  }

  function extractOption(element, index) {
    const keyNode = safeQuery(element, ".num_option, .option_index, .option-letter");
    const raw = elementText(element);
    const detected = elementText(keyNode).match(/[A-Z]/i) || raw.match(/^\s*([A-Z])\s*[.、．)]/i);
    const key = (detected ? detected[1] || detected[0] : optionKeyAt(index)).toUpperCase();
    const text = raw.replace(new RegExp("^\\s*" + key + "\\s*[.、．)]?\\s*", "i"), "").trim();
    const input = safeQuery(element, 'input[type="radio"], input[type="checkbox"]');
    const container = element && element.closest ? (element.closest("li") || element) : element;
    return { key, text, element, container, input };
  }

  function extractQuestion(root, index) {
    const title = safeQuery(root, ".mark_name, .fontLabel, .question-title, .stem");
    const typeInput = safeQuery(root, 'input[name^="answertype"], input[name^="type"]');
    const typeLabel = elementText(title) || elementText(root);
    const type = inferQuestionType(typeInput && typeInput.value, typeLabel);
    const options = safeQueryAll(root, ".answer_p, .option-item").map(extractOption);
    const editors = safeQueryAll(root, 'input[type="text"], textarea, [contenteditable="true"]')
      .filter((element) => !element.disabled && element.type !== "hidden");
    const explicitId = root && root.getAttribute && (root.getAttribute("data-question-id") || root.getAttribute("data-id"));
    const hiddenAnswer = safeQuery(root, 'input[id^="answer"]:not([id^="answertype"]), input[name^="answer"]:not([name^="answertype"])');
    const id = String(explicitId || (hiddenAnswer && (hiddenAnswer.id || hiddenAnswer.name)) || `question-${index + 1}`);
    const numberNode = safeQuery(root, ".question-number, .num, .order");
    const numberMatch = elementText(numberNode).match(/\d+/) || typeLabel.match(/^\s*(\d+)/);
    const number = numberMatch ? Number(numberMatch[1] || numberMatch[0]) : index + 1;
    const stem = stripQuestionPrefix(elementText(title) || elementText(root));
    return {
      id,
      number,
      type,
      stem,
      options,
      blankCount: type === "fill" ? editors.length : 0,
      root,
      editors,
      hiddenAnswer
    };
  }

  function extractQuestions(documentRef) {
    const roots = safeQueryAll(documentRef, ".questionLi, .TiMu, [data-question-id]")
      .filter((root) => {
        const isAggregateContainer = root && root.matches && root.matches(".TiMu") && safeQuery(root, ".questionLi");
        return !isAggregateContainer;
      });
    const seen = new Set();
    return roots.map(extractQuestion).filter((question) => {
      if (!question.stem || seen.has(question.root)) return false;
      seen.add(question.root);
      return true;
    });
  }

  function isQuestionAnswered(question) {
    if (["single", "multiple", "judgment"].includes(question.type)) {
      if (question.options.some((option) => option.input && option.input.checked)) return true;
      if (question.hiddenAnswer && normalizeWhitespace(question.hiddenAnswer.value)) return true;
      return question.options.some((option) => {
        const container = option.container;
        return !!(container && container.matches && container.matches(".selected, .checked, .check_answer, .check_answer_dx"));
      });
    }
    if (["fill", "short"].includes(question.type)) {
      return question.editors.some((editor) => normalizeWhitespace(editor.value != null ? editor.value : editor.textContent));
    }
    return false;
  }

  function questionPayload(question) {
    return {
      questionId: question.id,
      number: question.number,
      type: question.type,
      stem: question.stem,
      options: question.options.map((option) => ({ key: option.key, text: option.text })),
      blankCount: question.blankCount
    };
  }

  function buildPrompt(question) {
    const payload = questionPayload(question);
    const rules = {
      single: "answers 只能包含一个选项 key",
      multiple: "answers 包含所有正确选项 key，按字母顺序",
      judgment: 'answers 只能是 ["true"] 或 ["false"]',
      fill: `answers 按空格顺序给出 ${payload.blankCount || 1} 个纯文本答案`,
      short: "answers 只包含一个简洁、准确的纯文本答案"
    };
    return [
      "请解答下面的课程作业题。只返回一个 JSON 对象，禁止 Markdown、解释或额外文字。",
      `返回对象只能包含 questionId、type、answers 三个字段。questionId 固定为 ${JSON.stringify(payload.questionId)}，type 固定为 ${JSON.stringify(payload.type)}，answers 必须是字符串数组。`,
      `规则：${rules[payload.type] || "无法确定时返回空 answers"}。禁止改写或省略 questionId 和 type。`,
      JSON.stringify(payload)
    ].join("\n");
  }

  function parseJsonObject(raw) {
    const cleaned = String(raw || "").replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("AI 未返回 JSON 对象");
    return JSON.parse(cleaned.slice(start, end + 1));
  }

  function parseStructuredAnswer(raw, question) {
    const data = parseJsonObject(raw);
    if (String(data.questionId) !== String(question.id)) throw new Error("AI 返回的题目 ID 不匹配");
    if (data.type !== question.type) throw new Error("AI 返回的题型不匹配");
    if (!Array.isArray(data.answers) || data.answers.length === 0) throw new Error("AI 未返回有效答案数组");
    const answers = data.answers.map((answer) => normalizeWhitespace(answer)).filter(Boolean);
    if (!answers.length) throw new Error("AI 返回答案为空");

    if (["single", "multiple"].includes(question.type)) {
      const validKeys = new Set(question.options.map((option) => option.key));
      const keys = [...new Set(answers.map((answer) => answer.toUpperCase()))];
      if (keys.some((key) => !validKeys.has(key))) throw new Error("AI 返回了不存在的选项");
      if (question.type === "single" && keys.length !== 1) throw new Error("单选题答案数量不是 1");
      return { questionId: question.id, type: question.type, answers: keys };
    }
    if (question.type === "judgment") {
      const normalized = answers[0].toLowerCase();
      if (!["true", "false"].includes(normalized)) throw new Error("判断题答案必须是 true 或 false");
      return { questionId: question.id, type: question.type, answers: [normalized] };
    }
    if (question.type === "fill" && question.blankCount > 0 && answers.length !== question.blankCount) {
      throw new Error(`填空答案数量 ${answers.length} 与空格数量 ${question.blankCount} 不一致`);
    }
    if (question.type === "short" && answers.length !== 1) throw new Error("简答题只能返回一个答案");
    return { questionId: question.id, type: question.type, answers };
  }

  function dispatchValueEvents(element) {
    if (!element || !element.dispatchEvent || typeof Event === "undefined") return;
    for (const name of ["input", "change", "blur"]) {
      element.dispatchEvent(new Event(name, { bubbles: true }));
    }
  }

  function clickOption(option) {
    const target = option.input || option.container || option.element;
    if (!target) throw new Error(`找不到选项 ${option.key} 的表单元素`);
    if (typeof target.click === "function") target.click();
    if (option.input && !option.input.checked) option.input.checked = true;
    dispatchValueEvents(option.input || target);
  }

  function clearChoiceOptions(question) {
    for (const option of question.options) {
      if (option.input && option.input.checked) {
        option.input.checked = false;
        dispatchValueEvents(option.input);
      }
    }
    if (question.hiddenAnswer) {
      question.hiddenAnswer.value = "";
      dispatchValueEvents(question.hiddenAnswer);
    }
  }

  function fillQuestion(question, result, options = {}) {
    const overwrite = options.overwrite === true;
    if (!overwrite && isQuestionAnswered(question)) return { status: "protected", message: "已有答案，未覆盖" };
    if (question.type === "unknown") return { status: "failed", message: "无法识别题型" };

    if (["single", "multiple"].includes(question.type)) {
      if (overwrite) clearChoiceOptions(question);
      const selected = result.answers.map((key) => question.options.find((option) => option.key === key));
      if (selected.some((option) => !option)) return { status: "failed", message: "答案选项不存在" };
      selected.forEach(clickOption);
      return { status: "filled", message: `已选择 ${result.answers.join("、")}` };
    }

    if (question.type === "judgment") {
      if (overwrite) clearChoiceOptions(question);
      const isTrue = result.answers[0] === "true";
      const option = question.options.find((candidate) => {
        const text = candidate.text.toLowerCase();
        return isTrue ? /正确|对|是|true|√/.test(text) : /错误|错|否|false|×/.test(text);
      });
      if (!option) return { status: "failed", message: "找不到判断题对应选项" };
      clickOption(option);
      return { status: "filled", message: isTrue ? "已选择正确" : "已选择错误" };
    }

    if (["fill", "short"].includes(question.type)) {
      if (!question.editors.length) return { status: "failed", message: "找不到可填写的输入框" };
      if (question.type === "fill" && result.answers.length !== question.editors.length) {
        return { status: "failed", message: "答案数量与输入框数量不一致" };
      }
      const values = question.type === "short" ? [result.answers[0]] : result.answers;
      values.forEach((value, index) => {
        const editor = question.editors[index];
        if (editor.value != null) editor.value = value;
        else editor.textContent = value;
        dispatchValueEvents(editor);
      });
      return { status: "filled", message: `已填写 ${values.length} 项` };
    }
    return { status: "failed", message: "不支持的题型" };
  }

  function gmRequest(details) {
    return GM_xmlhttpRequest(details);
  }

  function normalizeModel(value) {
    const requested = String(value || "");
    return MODEL_OPTIONS.some((option) => option.value === requested) ? requested : MODEL;
  }

  function requestDeepSeek({ apiKey, model = MODEL, question, controller, timeoutMs = 45000, maxAttempts = 3, request = gmRequest, retryDelay }) {
    const prompt = buildPrompt(question);
    const execute = (attempt) => new Promise((resolve, reject) => {
      let settled = false;
      let unregister = () => {};
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        unregister();
        callback(value);
      };
      const handle = request({
        method: "POST",
        url: API_URL,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        data: JSON.stringify({
          model: normalizeModel(model),
          stream: false,
          thinking: { type: "disabled" },
          response_format: { type: "json_object" },
          temperature: 0.1,
          max_tokens: question.type === "short" ? 500 : 180,
          messages: [
            { role: "system", content: "你是课程作业答题助手。严格遵守用户要求的 JSON 格式。" },
            { role: "user", content: prompt }
          ]
        }),
        timeout: timeoutMs,
        onload(response) {
          const status = Number(response.status || 0);
          if (status === 401 || status === 403) return finish(reject, new Error("API Key 无效或无权限"));
          if (status === 429 || status >= 500) return finish(resolve, { retry: true, status });
          if (status !== 200) return finish(reject, new Error(`DeepSeek API 返回 HTTP ${status}`));
          try {
            const body = JSON.parse(response.responseText || "{}");
            const content = body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
            const parsed = parseStructuredAnswer(content, question);
            finish(resolve, { retry: false, parsed, usage: body.usage || {} });
          } catch (error) {
            if (attempt < Math.min(maxAttempts, 2)) {
              finish(resolve, { retry: true, status: 200, formatError: error });
            } else {
              finish(reject, error);
            }
          }
        },
        onerror() { finish(resolve, { retry: true, status: 0 }); },
        ontimeout() { finish(resolve, { retry: true, timeout: true, status: 0 }); },
        onabort() { finish(reject, new TaskStoppedError()); }
      });
      unregister = controller.registerAbort(() => {
        try { if (handle && typeof handle.abort === "function") handle.abort(); } catch (_) {}
        finish(reject, new TaskStoppedError());
      });
    }).then(async (result) => {
      if (!result.retry) return result;
      if (attempt >= maxAttempts) {
        throw new Error(result.timeout ? "DeepSeek API 请求超时" : `DeepSeek API 请求失败（HTTP ${result.status || "网络错误"}）`);
      }
      await controller.checkpoint();
      const waitMs = typeof retryDelay === "function"
        ? retryDelay(result, attempt)
        : (result.formatError ? 300 : (result.status === 429 ? 3000 * attempt : 1200 * attempt));
      await delay(waitMs);
      await controller.checkpoint();
      return execute(attempt + 1);
    });
    return execute(1);
  }

  function readConfig() {
    const saved = typeof GM_getValue === "function" ? GM_getValue(CONFIG_KEY, {}) : {};
    return {
      apiKey: String(saved && saved.apiKey || ""),
      model: normalizeModel(saved && saved.model)
    };
  }

  function saveConfig(config) {
    if (typeof GM_setValue === "function") {
      GM_setValue(CONFIG_KEY, {
        apiKey: String(config.apiKey || ""),
        model: normalizeModel(config.model)
      });
    }
  }

  function createPanel(documentRef) {
    const style = documentRef.createElement("style");
    style.textContent = `
      #cxhw-panel{position:fixed;right:18px;top:82px;width:320px;max-height:calc(100vh - 110px);z-index:2147483646;background:rgba(255,255,255,.97);border:1px solid #dbeafe;border-radius:14px;box-shadow:0 12px 36px rgba(30,64,175,.18);font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#1f2937;overflow:hidden}
      #cxhw-panel *{box-sizing:border-box}#cxhw-panel header{padding:12px 14px;background:linear-gradient(135deg,#2563eb,#4f46e5);color:#fff}#cxhw-panel header strong{font-size:15px}#cxhw-panel header small{display:block;opacity:.86;margin-top:2px}
      #cxhw-panel .cxhw-body{padding:12px;overflow:auto;max-height:calc(100vh - 180px)}#cxhw-panel .cxhw-row{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:9px}#cxhw-panel button{border:0;border-radius:7px;padding:7px 10px;cursor:pointer;background:#e5e7eb;color:#111827}#cxhw-panel button.primary{background:#2563eb;color:#fff}#cxhw-panel button.danger{background:#fee2e2;color:#b91c1c}#cxhw-panel button:disabled{opacity:.45;cursor:not-allowed}
      #cxhw-panel .cxhw-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:8px 0}#cxhw-panel .cxhw-stat{background:#f8fafc;border-radius:8px;padding:7px;text-align:center}#cxhw-panel .cxhw-stat b{display:block;font-size:16px;color:#1d4ed8}
      #cxhw-panel .cxhw-progress{height:7px;background:#e5e7eb;border-radius:99px;overflow:hidden}#cxhw-panel .cxhw-progress i{display:block;height:100%;width:0;background:#2563eb;transition:width .2s}
      #cxhw-panel .cxhw-settings{display:none;padding:9px;background:#f8fafc;border-radius:8px;margin-bottom:9px}#cxhw-panel .cxhw-settings.open{display:block}#cxhw-panel input[type=password],#cxhw-panel select{width:100%;padding:7px;border:1px solid #cbd5e1;border-radius:6px;margin:5px 0 7px;background:#fff}#cxhw-panel label{display:block}
      #cxhw-panel .cxhw-log{height:150px;overflow:auto;background:#0f172a;color:#cbd5e1;border-radius:8px;padding:8px;font:12px/1.5 Consolas,monospace;white-space:pre-wrap}#cxhw-panel .cxhw-note{color:#b45309;background:#fffbeb;border-radius:7px;padding:7px;margin-bottom:9px}
    `;
    documentRef.head.appendChild(style);
    const panel = documentRef.createElement("section");
    panel.id = "cxhw-panel";
    panel.innerHTML = `
      <header><strong>学习通 AI 独立作业助手</strong><small>V${VERSION} · 只填写，绝不自动提交</small></header>
      <div class="cxhw-body">
        <div class="cxhw-note">请先确认当前作业允许使用 AI。答案填完后由你检查并点击学习通原生提交按钮。</div>
        <div class="cxhw-row">
          <button data-action="start" class="primary">开始答题</button><button data-action="pause">暂停</button><button data-action="resume">继续</button><button data-action="stop" class="danger">停止</button>
        </div>
        <div class="cxhw-row"><button data-action="settings">API 设置</button><button data-action="test">测试连接</button></div>
        <div class="cxhw-settings">
          <label>DeepSeek API Key<input data-field="apiKey" type="password" autocomplete="off" placeholder="仅保存在 Tampermonkey 本地"></label>
          <label>模型<select data-field="model"><option value="deepseek-flash">DeepSeek Flash（V4.1，低成本）</option><option value="deepseek-v4-pro">DeepSeek V4 Pro（更强能力）</option></select></label>
          <label><input data-field="overwrite" type="checkbox"> 重新填写并覆盖已有答案</label>
          <button data-action="save">保存设置</button>
        </div>
        <div>状态：<b data-field="status">等待开始</b></div>
        <div class="cxhw-progress"><i data-field="bar"></i></div>
        <div class="cxhw-stats"><div class="cxhw-stat">进度<b data-field="progress">0/0</b></div><div class="cxhw-stat">成功<b data-field="success">0</b></div><div class="cxhw-stat">失败<b data-field="failed">0</b></div></div>
        <div class="cxhw-log" data-field="log"></div>
      </div>`;
    documentRef.body.appendChild(panel);
    return panel;
  }

  function initRuntime(documentRef, locationRef) {
    if (!isIndependentHomeworkPath(locationRef.pathname)) return null;
    if (documentRef.getElementById("cxhw-panel")) return null;
    const panel = createPanel(documentRef);
    const $ = (selector) => panel.querySelector(selector);
    const fields = {
      status: $('[data-field="status"]'), bar: $('[data-field="bar"]'), progress: $('[data-field="progress"]'),
      success: $('[data-field="success"]'), failed: $('[data-field="failed"]'), log: $('[data-field="log"]'),
      apiKey: $('[data-field="apiKey"]'), model: $('[data-field="model"]'), overwrite: $('[data-field="overwrite"]'), settings: $(".cxhw-settings")
    };
    const savedConfig = readConfig();
    fields.apiKey.value = savedConfig.apiKey;
    fields.model.value = savedConfig.model;
    let activeController = null;
    let activePromise = null;

    const log = (message, level = "info") => {
      const stamp = new Date().toLocaleTimeString();
      fields.log.textContent += `[${stamp}] ${level === "error" ? "失败 " : ""}${message}\n`;
      fields.log.scrollTop = fields.log.scrollHeight;
    };
    const update = ({ current = 0, total = 0, success = 0, failed = 0, status }) => {
      fields.progress.textContent = `${current}/${total}`;
      fields.success.textContent = String(success);
      fields.failed.textContent = String(failed);
      fields.bar.style.width = total ? `${Math.round(current / total * 100)}%` : "0%";
      if (status) fields.status.textContent = status;
    };
    const getApiKey = () => String(fields.apiKey.value || "").trim();
    const getModel = () => normalizeModel(fields.model.value);

    async function runHomework() {
      const controller = new TaskController();
      if (!controller.start()) return;
      activeController = controller;
      const questions = extractQuestions(documentRef);
      let success = 0, failed = 0, current = 0;
      update({ current, total: questions.length, success, failed, status: "正在答题" });
      if (!questions.length) {
        log("未找到独立作业题目，请确认页面已加载完成。", "error");
        update({ status: "未找到题目" });
        controller.complete();
        return;
      }
      log(`识别到 ${questions.length} 道题。`);
      try {
        for (const question of questions) {
          await controller.checkpoint();
          if (question.type === "unknown") {
            failed++; current++; log(`第 ${question.number} 题：无法识别题型，已跳过。`, "error");
            update({ current, total: questions.length, success, failed });
            continue;
          }
          if (!fields.overwrite.checked && isQuestionAnswered(question)) {
            current++; log(`第 ${question.number} 题：检测到已有答案，已保护并跳过。`);
            update({ current, total: questions.length, success, failed });
            continue;
          }
          log(`第 ${question.number} 题：正在请求 DeepSeek…`);
          try {
            const response = await requestDeepSeek({ apiKey: getApiKey(), model: getModel(), question, controller });
            await controller.checkpoint();
            const result = fillQuestion(question, response.parsed, { overwrite: fields.overwrite.checked });
            await controller.checkpoint();
            if (result.status === "filled") { success++; log(`第 ${question.number} 题：${result.message}`); }
            else if (result.status === "protected") log(`第 ${question.number} 题：${result.message}`);
            else { failed++; log(`第 ${question.number} 题：${result.message}`, "error"); }
          } catch (error) {
            if (error instanceof TaskStoppedError) throw error;
            failed++; log(`第 ${question.number} 题：${error.message}`, "error");
          }
          current++;
          update({ current, total: questions.length, success, failed });
        }
        controller.complete();
        update({ current, total: questions.length, success, failed, status: "填写完成，请人工检查" });
        log("全部题目处理完成。脚本不会提交作业，请检查后手动提交。" );
      } catch (error) {
        if (error instanceof TaskStoppedError) {
          update({ current, total: questions.length, success, failed, status: "已停止" });
          log("任务已停止，后续题目不会请求或填写。" );
        } else {
          update({ current, total: questions.length, success, failed, status: "运行异常" });
          log(error.message || String(error), "error");
        }
      } finally {
        activeController = null;
        activePromise = null;
      }
    }

    panel.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const action = button.dataset.action;
      if (action === "settings") fields.settings.classList.toggle("open");
      if (action === "save") { saveConfig({ apiKey: getApiKey(), model: getModel() }); log(`API 设置已保存；当前模型：${getModel()}。` ); }
      if (action === "start") {
        if (activePromise || (activeController && ["running", "paused"].includes(activeController.state))) {
          log("已有答题任务正在运行，已忽略重复启动。" );
          return;
        }
        if (!getApiKey()) { fields.settings.classList.add("open"); log("请先填写并保存 DeepSeek API Key。", "error"); return; }
        const task = runHomework();
        activePromise = task;
        task.finally(() => {
          if (activePromise === task) activePromise = null;
          if (activeController && !["running", "paused"].includes(activeController.state)) activeController = null;
        });
      }
      if (action === "pause") {
        if (activeController && activeController.pause()) { fields.status.textContent = "已暂停"; log("已暂停；不会发送新的 API 请求或填写答案。" ); }
      }
      if (action === "resume") {
        if (activeController && activeController.resume()) { fields.status.textContent = "正在答题"; log("已继续答题。" ); }
      }
      if (action === "stop") {
        if (activeController && activeController.stop()) { fields.status.textContent = "正在停止"; log("正在停止当前任务…" ); }
      }
      if (action === "test") {
        if (activePromise) { log("答题任务运行中，暂不执行连接测试。", "error"); return; }
        if (!getApiKey()) { fields.settings.classList.add("open"); log("请先填写 DeepSeek API Key。", "error"); return; }
        const testQuestion = { id: "connection-test", number: 0, type: "judgment", stem: "1 等于 1。", options: [{ key: "A", text: "正确" }, { key: "B", text: "错误" }], blankCount: 0 };
        const controller = new TaskController(); controller.start();
        fields.status.textContent = "正在测试 API";
        try {
          await requestDeepSeek({ apiKey: getApiKey(), model: getModel(), question: testQuestion, controller, timeoutMs: 20000, maxAttempts: 1 });
          fields.status.textContent = "API 连接正常"; log("DeepSeek API 连接测试成功。" );
        } catch (error) {
          fields.status.textContent = "API 连接失败"; log(`连接测试失败：${error.message}`, "error");
        } finally { controller.complete(); }
      }
    });
    log("已识别为学习通独立作业页面。等待用户点击“开始答题”。" );
    return { panel, get activeController() { return activeController; } };
  }

  const exported = {
    VERSION, API_URL, MODEL, MODEL_OPTIONS, SUPPORTED_PATHS, TaskController, TaskStoppedError,
    isIndependentHomeworkPath, normalizeWhitespace, stripQuestionPrefix, inferQuestionType,
    extractOption, extractQuestion, extractQuestions, isQuestionAnswered, questionPayload,
    buildPrompt, parseStructuredAnswer, fillQuestion, normalizeModel, requestDeepSeek, initRuntime
  };

  if (typeof module !== "undefined" && module.exports) module.exports = exported;
  global.ChaoxingHomeworkAssistant = exported;
  if (typeof document !== "undefined" && typeof location !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initRuntime(document, location), { once: true });
    else initRuntime(document, location);
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
