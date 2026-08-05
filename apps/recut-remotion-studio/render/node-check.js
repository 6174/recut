try {
  require("@remotion/renderer");
  require("@remotion/bundler");
  require("remotion");
  console.log("remotion-render: ok");
  process.exit(0);
} catch (error) {
  console.error("remotion-render: missing dependencies");
  console.error(String(error && error.message ? error.message : error));
  process.exit(1);
}
