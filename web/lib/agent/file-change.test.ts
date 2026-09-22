import assert from "node:assert/strict";
import test from "node:test";

import { changeDiff, extractFileChanges, isFileChangeCall } from "./file-change";

test("opencode write is normalized to an add with full content", () => {
  const call = {
    state: "success" as const,
    input: JSON.stringify({ input: { content: "a\nb\n", filePath: "/p/files/N.md" } }),
    output: "Wrote file successfully.",
    payload: { tool: "write", toolName: "write", filePath: "/p/files/N.md", fileExists: false },
  };
  assert.equal(isFileChangeCall(call.payload), true);
  const [change] = extractFileChanges(call);
  assert.equal(change.kind, "add");
  assert.equal(change.path, "/p/files/N.md");
  assert.equal(change.content, "a\nb\n");
});

test("opencode write over an existing file is a modify", () => {
  const call = {
    state: "success" as const,
    input: JSON.stringify({ input: { content: "next", filePath: "/p/a.md" } }),
    payload: { tool: "write", toolName: "write", fileExists: true },
  };
  assert.equal(extractFileChanges(call)[0].kind, "modify");
});

test("opencode edit uses the forwarded diff", () => {
  const call = {
    state: "success" as const,
    input: JSON.stringify({ input: { filePath: "/p/a.md", oldString: "x", newString: "y" } }),
    payload: { tool: "edit", toolName: "edit", diff: "@@ -1 +1 @@\n-x\n+y" },
  };
  const [change] = extractFileChanges(call);
  assert.equal(change.kind, "modify");
  assert.match(change.diff ?? "", /\+y/);
});

test("opencode edit synthesizes a diff when none is forwarded", () => {
  const call = {
    state: "success" as const,
    input: JSON.stringify({ input: { filePath: "/p/a.md", oldString: "x", newString: "y" } }),
    payload: { tool: "edit", toolName: "edit" },
  };
  const [change] = extractFileChanges(call);
  assert.match(change.diff ?? "", /-x/);
  assert.match(change.diff ?? "", /\+y/);
});

test("codex file_change falls back to the changes list", () => {
  const call = {
    state: "success" as const,
    output: JSON.stringify({ changes: [{ kind: "add", path: "/p/a.md" }, { kind: "modify", path: "/p/b.md" }] }),
    payload: { tool: "file_change", toolName: "" },
  };
  assert.equal(isFileChangeCall(call.payload), true);
  const changes = extractFileChanges(call);
  assert.equal(changes.length, 2);
  assert.deepEqual(changes.map((c) => c.kind), ["add", "modify"]);
});

test("changeDiff synthesizes an all-add diff for new files", () => {
  const [change] = extractFileChanges({
    state: "success" as const,
    input: JSON.stringify({ input: { content: "a\nb", filePath: "/p/new.md" } }),
    payload: { tool: "write", toolName: "write", fileExists: false },
  });
  const diff = changeDiff(change);
  assert.match(diff ?? "", /\+a/);
  assert.match(diff ?? "", /\+b/);
});

test("changeDiff keeps the real diff and skips overwrite writes", () => {
  const [edit] = extractFileChanges({
    state: "success" as const,
    input: JSON.stringify({ input: { filePath: "/p/a.md" } }),
    payload: { tool: "edit", toolName: "edit", diff: "@@ -1 +1 @@\n-x\n+y" },
  });
  assert.equal(changeDiff(edit), "@@ -1 +1 @@\n-x\n+y");
  const [overwrite] = extractFileChanges({
    state: "success" as const,
    input: JSON.stringify({ input: { content: "next", filePath: "/p/a.md" } }),
    payload: { tool: "write", toolName: "write", fileExists: true },
  });
  assert.equal(changeDiff(overwrite), undefined);
});

test("non file tools are ignored", () => {
  assert.equal(isFileChangeCall({ tool: "bash", toolName: "bash" }), false);
  assert.equal(isFileChangeCall(null), false);
  assert.equal(extractFileChanges({ state: "success", payload: { tool: "read", toolName: "read" } }).length, 0);
});
