#!/usr/bin/env node
// 把 base64 文本文件解码为二进制文件。供 background.js export.complete 使用。
// usage: node decode-base64.js <input.b64> <output.bin>
const fs = require("fs");
const path = require("path");

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error("usage: node decode-base64.js <input.b64> <output.bin>");
  process.exit(1);
}

try {
  const base64 = fs.readFileSync(inputPath, "utf8").replace(/\s+/g, "");
  const buf = Buffer.from(base64, "base64");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buf);
  console.log(`decoded ${base64.length} chars -> ${buf.length} bytes: ${outputPath}`);
} catch (err) {
  console.error("decode failed:", err.message);
  process.exit(1);
}
