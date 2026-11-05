const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "src", "chaoxing-homework-assistant.user.js");
const output = path.join(root, "chaoxing-homework-assistant.user.js");

const content = fs.readFileSync(source, "utf8");
if (!content.startsWith("// ==UserScript==")) {
  throw new Error("源文件缺少 Tampermonkey 元数据头");
}
fs.writeFileSync(output, content, "utf8");
console.log(`Built ${path.relative(root, output)} (${Buffer.byteLength(content)} bytes)`);
