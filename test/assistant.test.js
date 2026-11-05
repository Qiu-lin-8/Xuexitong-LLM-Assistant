const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const assistant = require("../src/chaoxing-homework-assistant.user.js");

class FakeField {
  constructor({ value = "", checked = false, type = "text" } = {}) {
    this.value = value;
    this.checked = checked;
    this.type = type;
    this.textContent = "";
    this.events = [];
    this.clickCount = 0;
  }
  click() { this.clickCount++; this.checked = true; }
  dispatchEvent(event) { this.events.push(event.type); return true; }
}

function fakeTextElement(text, selectors = {}) {
  return {
    innerText: text,
    textContent: text,
    value: selectors.value,
    type: selectors.type,
    disabled: false,
    querySelector(selector) { return selectors[selector] || null; },
    querySelectorAll(selector) { return selectors[selector] || []; },
    closest() { return this; },
    getAttribute(name) { return selectors[`@${name}`] || null; }
  };
}

function choiceQuestion(type = "single", count = 5) {
  const options = Array.from({ length: count }, (_, index) => {
    const input = new FakeField({ type: type === "multiple" ? "checkbox" : "radio" });
    return { key: String.fromCharCode(65 + index), text: `选项${index + 1}`, input, container: input, element: input };
  });
  return { id: "q-choice", number: 1, type, stem: "请选择正确答案", options, blankCount: 0, editors: [], hiddenAnswer: null };
}

function textQuestion(type, count) {
  return { id: `q-${type}`, number: 1, type, stem: "请填写答案", options: [], blankCount: type === "fill" ? count : 0, editors: Array.from({ length: count }, () => new FakeField()), hiddenAnswer: null };
}

test("只识别独立作业路径，排除章节与考试", () => {
  for (const pathname of ["/mooc2/work/dowork", "/mooc-ans/mooc2/work/dowork", "/mooc2-ans/mooc2/work/dowork", "/work/doHomeWorkNew"]) {
    assert.equal(assistant.isIndependentHomeworkPath(pathname), true);
  }
  for (const pathname of ["/mycourse/studentstudy", "/exam-ans/exam/test/reVersionTestStartNew", "/knowledge/cards", "/work/selectWorkQuestionYiPiYue"]) {
    assert.equal(assistant.isIndependentHomeworkPath(pathname), false);
  }
});

test("识别五种题型", () => {
  assert.equal(assistant.inferQuestionType("0", ""), "single");
  assert.equal(assistant.inferQuestionType("1", ""), "multiple");
  assert.equal(assistant.inferQuestionType("3", ""), "judgment");
  assert.equal(assistant.inferQuestionType("2", ""), "fill");
  assert.equal(assistant.inferQuestionType("4", ""), "short");
  assert.equal(assistant.inferQuestionType("", "（简答题）说明原因"), "short");
});

test("从模拟学习通 DOM 提取编号、题型、题干、选项和表单元素", () => {
  const radioA = new FakeField({ type: "radio" });
  const radioB = new FakeField({ type: "radio" });
  const optionA = fakeTextElement("A. 上海", { ".num_option, .option_index, .option-letter": fakeTextElement("A"), 'input[type="radio"], input[type="checkbox"]': radioA });
  const optionB = fakeTextElement("B. 北京", { ".num_option, .option_index, .option-letter": fakeTextElement("B"), 'input[type="radio"], input[type="checkbox"]': radioB });
  const title = fakeTextElement("1.（单选题）中国的首都是？");
  const typeInput = new FakeField({ value: "0", type: "hidden" });
  const answerInput = new FakeField({ value: "", type: "hidden" });
  const root = fakeTextElement("1.（单选题）中国的首都是？ A. 上海 B. 北京", {
    ".mark_name, .fontLabel, .question-title, .stem": title,
    'input[name^="answertype"], input[name^="type"]': typeInput,
    'input[id^="answer"]:not([id^="answertype"]), input[name^="answer"]:not([name^="answertype"])': answerInput,
    ".answer_p, .option-item": [optionA, optionB],
    'input[type="text"], textarea, [contenteditable="true"]': [],
    "@data-question-id": "dom-q1"
  });
  const question = assistant.extractQuestion(root, 0);
  assert.equal(question.id, "dom-q1");
  assert.equal(question.number, 1);
  assert.equal(question.type, "single");
  assert.equal(question.stem, "中国的首都是？");
  assert.deepEqual(question.options.map((option) => [option.key, option.text]), [["A", "上海"], ["B", "北京"]]);
  assert.equal(question.options[1].input, radioB);
  assert.equal(question.hiddenAnswer, answerInput);
  assert.equal(assistant.isQuestionAnswered(question), false);
});

test("学习通 TiMu 总容器包含 questionLi 时不会被重复识别为题目", () => {
  const questionA = fakeTextElement("1.（单选题）题目一", {
    ".mark_name, .fontLabel, .question-title, .stem": fakeTextElement("1.（单选题）题目一")
  });
  const questionB = fakeTextElement("2.（单选题）题目二", {
    ".mark_name, .fontLabel, .question-title, .stem": fakeTextElement("2.（单选题）题目二")
  });
  const aggregate = fakeTextElement("题目一 题目二", { ".questionLi": questionA });
  aggregate.matches = (selector) => selector === ".TiMu";
  const documentRef = {
    querySelectorAll(selector) {
      assert.equal(selector, ".questionLi, .TiMu, [data-question-id]");
      return [aggregate, questionA, questionB];
    }
  };

  const questions = assistant.extractQuestions(documentRef);
  assert.equal(questions.length, 2);
  assert.deepEqual(questions.map((question) => question.number), [1, 2]);
});

test("单选题支持超过四个选项并准确填写", () => {
  const question = choiceQuestion("single", 5);
  const parsed = assistant.parseStructuredAnswer('{"questionId":"q-choice","type":"single","answers":["E"]}', question);
  const result = assistant.fillQuestion(question, parsed);
  assert.equal(result.status, "filled");
  assert.equal(question.options[4].input.checked, true);
  assert.equal(question.options[0].input.checked, false);
});

test("多选题按结构化选项填写且不串题", () => {
  const question = choiceQuestion("multiple", 6);
  const parsed = assistant.parseStructuredAnswer('{"questionId":"q-choice","type":"multiple","answers":["A","C","F"]}', question);
  assistant.fillQuestion(question, parsed);
  assert.deepEqual(question.options.map((option) => option.input.checked), [true, false, true, false, false, true]);
  assert.throws(() => assistant.parseStructuredAnswer('{"questionId":"other","type":"multiple","answers":["A"]}', question), /ID 不匹配/);
});

test("判断题兼容正确和错误选项文本", () => {
  const question = choiceQuestion("judgment", 2);
  question.id = "q-judge";
  question.options[0].text = "正确";
  question.options[1].text = "错误";
  const parsed = assistant.parseStructuredAnswer('{"questionId":"q-judge","type":"judgment","answers":["false"]}', question);
  const result = assistant.fillQuestion(question, parsed);
  assert.equal(result.status, "filled");
  assert.equal(question.options[1].input.checked, true);
});

test("多空填空题按顺序填写并触发事件", () => {
  const question = textQuestion("fill", 3);
  const parsed = assistant.parseStructuredAnswer('{"questionId":"q-fill","type":"fill","answers":["甲","乙","丙"]}', question);
  const result = assistant.fillQuestion(question, parsed);
  assert.equal(result.status, "filled");
  assert.deepEqual(question.editors.map((editor) => editor.value), ["甲", "乙", "丙"]);
  assert.deepEqual(question.editors[0].events, ["input", "change", "blur"]);
});

test("简答题填写纯文本", () => {
  const question = textQuestion("short", 1);
  const parsed = assistant.parseStructuredAnswer('{"questionId":"q-short","type":"short","answers":["这是简答内容。"]}', question);
  assistant.fillQuestion(question, parsed);
  assert.equal(question.editors[0].value, "这是简答内容。");
});

test("拒绝异常 JSON、错误题型和填空数量不一致", () => {
  const question = textQuestion("fill", 2);
  assert.throws(() => assistant.parseStructuredAnswer("不是 JSON", question), /JSON/);
  assert.throws(() => assistant.parseStructuredAnswer('{"questionId":"q-fill","type":"short","answers":["A"]}', question), /题型不匹配/);
  assert.throws(() => assistant.parseStructuredAnswer('{"questionId":"q-fill","type":"fill","answers":["A"]}', question), /数量/);
});

test("提示词只携带真实题目 ID，不包含可被照抄的占位 ID", () => {
  const question = textQuestion("fill", 2);
  const prompt = assistant.buildPrompt(question);
  assert.equal(prompt.includes('"questionId":"题目ID"'), false);
  assert.equal(prompt.includes('"questionId":"q-fill"'), true);
});

test("默认保护用户已经填写的答案，明确覆盖时才重填", () => {
  const question = choiceQuestion("single", 3);
  question.options[0].input.checked = true;
  const answer = { questionId: question.id, type: question.type, answers: ["C"] };
  assert.equal(assistant.fillQuestion(question, answer).status, "protected");
  assert.equal(question.options[0].input.checked, true);
  assert.equal(assistant.fillQuestion(question, answer, { overwrite: true }).status, "filled");
  assert.deepEqual(question.options.map((option) => option.input.checked), [false, false, true]);
});

test("任务控制器阻止重复开始并支持暂停、恢复、停止", async () => {
  const controller = new assistant.TaskController();
  assert.equal(controller.start(), true);
  assert.equal(controller.start(), false);
  assert.equal(controller.pause(), true);
  let passed = false;
  const waiting = controller.checkpoint().then(() => { passed = true; });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(passed, false);
  assert.equal(controller.resume(), true);
  await waiting;
  assert.equal(passed, true);
  assert.equal(controller.stop(), true);
  await assert.rejects(controller.checkpoint(), assistant.TaskStoppedError);
});

test("完成状态允许开始下一轮任务", () => {
  const controller = new assistant.TaskController();
  assert.equal(controller.start(), true);
  controller.complete();
  assert.equal(controller.start(), true);
});

test("API 超时会重试，成功后校验结构化答案", async () => {
  const question = choiceQuestion("single", 2);
  const controller = new assistant.TaskController(); controller.start();
  let calls = 0;
  const request = (details) => {
    calls++;
    const currentCall = calls;
    setTimeout(() => {
      if (currentCall === 1) details.ontimeout();
      else details.onload({ status: 200, responseText: JSON.stringify({ choices: [{ message: { content: '{"questionId":"q-choice","type":"single","answers":["B"]}' } }], usage: { total_tokens: 12 } }) });
    }, 0);
    return { abort() { details.onabort(); } };
  };
  const response = await assistant.requestDeepSeek({ apiKey: "test-only", question, controller, request, timeoutMs: 10, maxAttempts: 2, retryDelay: () => 0 });
  assert.equal(calls, 2);
  assert.deepEqual(response.parsed.answers, ["B"]);
});

test("HTTP 429 限流会等待后重试", async () => {
  const question = choiceQuestion("single", 2);
  const controller = new assistant.TaskController(); controller.start();
  let calls = 0;
  const request = (details) => {
    calls++;
    const currentCall = calls;
    setTimeout(() => currentCall === 1
      ? details.onload({ status: 429, responseText: "{}" })
      : details.onload({ status: 200, responseText: JSON.stringify({ choices: [{ message: { content: '{"questionId":"q-choice","type":"single","answers":["A"]}' } }] }) }), 0);
    return { abort() { details.onabort(); } };
  };
  const response = await assistant.requestDeepSeek({ apiKey: "test-only", question, controller, request, maxAttempts: 2, retryDelay: () => 0 });
  assert.equal(calls, 2);
  assert.deepEqual(response.parsed.answers, ["A"]);
});

test("AI 首次返回错误题目 ID 时重试且绝不填写错题答案", async () => {
  const question = textQuestion("short", 1);
  const controller = new assistant.TaskController(); controller.start();
  let calls = 0;
  const request = (details) => {
    calls++;
    const content = calls === 1
      ? '{"questionId":"题目ID","type":"short","answers":["错误结果"]}'
      : '{"questionId":"q-short","type":"short","answers":["正确结果"]}';
    setTimeout(() => details.onload({ status: 200, responseText: JSON.stringify({ choices: [{ message: { content } }] }) }), 0);
    return { abort() { details.onabort(); } };
  };
  const response = await assistant.requestDeepSeek({ apiKey: "test-only", question, controller, request, maxAttempts: 3, retryDelay: () => 0 });
  assert.equal(calls, 2);
  assert.deepEqual(response.parsed.answers, ["正确结果"]);
  assert.equal(question.editors[0].value, "");
});

test("停止任务会中止正在进行的 API 请求", async () => {
  const question = choiceQuestion("single", 2);
  const controller = new assistant.TaskController(); controller.start();
  let aborted = false;
  const request = (details) => ({ abort() { aborted = true; details.onabort(); } });
  const pending = assistant.requestDeepSeek({ apiKey: "test-only", question, controller, request });
  controller.stop();
  await assert.rejects(pending, assistant.TaskStoppedError);
  assert.equal(aborted, true);
});

test("V1 运行代码不包含任何学习通提交调用", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "chaoxing-homework-assistant.user.js"), "utf8");
  for (const forbidden of ["btnBlueSubmit", "submitCheckTimes", "confirmSubmitWork", "noSubmit(", ".submit("]) {
    assert.equal(source.includes(forbidden), false, `发现禁止的提交调用：${forbidden}`);
  }
});
