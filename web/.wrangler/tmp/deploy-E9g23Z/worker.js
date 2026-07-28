// worker.ts
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/projects\/([^/]+)\/?$/);
    if (match && match[1] !== "app") {
      const shell = new URL("/projects/app/", url);
      return env.ASSETS.fetch(new Request(shell, request));
    }
    return env.ASSETS.fetch(request);
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
