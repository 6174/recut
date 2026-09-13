//! pomelo-vello-wasm：vello(WASM/WebGPU) 光栅器运行时。
//! - `ops`：JS op 字节流解码 + vello `Scene` 构建（可在 host 上单元测试，见 `cargo test`）。
//! - `runtime`：wgpu 设备/瓦片光栅/合成（仅 wasm32 编译）。
//! 见 rfc/2026-09-13-vello-native-rendering-implementation.md。
#[allow(dead_code)]
mod ops;

#[cfg(target_arch = "wasm32")]
mod compositor;
#[cfg(target_arch = "wasm32")]
mod runtime;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn version() -> String {
    "pomelo-vello-wasm 0.1.0".to_string()
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub async fn create_runtime(
    canvas: web_sys::HtmlCanvasElement,
) -> Result<runtime::VelloRuntime, JsValue> {
    runtime::VelloRuntime::create(canvas).await
}
