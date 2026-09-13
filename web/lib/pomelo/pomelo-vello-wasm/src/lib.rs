//! pomelo-vello-wasm：vello(WASM/WebGPU) 光栅器运行时。
//! v1 只落地「设备初始化 + 尺寸配置」；瓦片光栅/合成待 M1 后续接入（见 rfc/2026-09-13-vello-native-rendering-implementation.md）。
use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;

mod runtime;

#[wasm_bindgen]
pub fn version() -> String {
    "pomelo-vello-wasm 0.1.0".to_string()
}

#[wasm_bindgen]
pub async fn create_runtime(canvas: HtmlCanvasElement) -> Result<runtime::VelloRuntime, JsValue> {
    runtime::VelloRuntime::create(canvas).await
}
