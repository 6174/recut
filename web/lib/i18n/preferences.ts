/*
 * [INPUT]: 依赖 /v1/preferences（service user_settings 表）与 locales.ts / locale-store.ts 的本地兜底探测
 * [OUTPUT]: 工作台语言偏好的服务端持久化集成点：loadLocalePreference 读 service 权威值（失败回退 localStorage/navigator），saveLocalePreference 写回 service（失败静默，不阻塞 UI）
 * [POS]: web/lib/i18n 的偏好持久化边界；设置面板语言切换时调用，与 locale-store 的 localStorage 兜底同源同值，以 service 为准
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { detectLocale, type Locale } from "./locales";
import { readStoredLocale } from "./locale-store";
import { fetchRecutJSON } from "@/lib/service-endpoint";

export type LocalePreferenceResponse = { locale?: Locale };

// 读 service 的 /v1/preferences；不可用时回退本地存储，再回退浏览器语言探测。
export async function loadLocalePreference(endpoint: string): Promise<Locale> {
  try {
    const preference = await fetchRecutJSON<LocalePreferenceResponse>(endpoint, "/v1/preferences");
    if (preference.locale === "zh" || preference.locale === "en") return preference.locale;
  } catch {
    // 旧版 service 无该端点或未持久化：静默回退本地。
  }
  return readStoredLocale() ?? detectLocale(typeof navigator === "undefined" ? undefined : navigator.language);
}

// 写 service 的 /v1/preferences；失败静默，不阻塞语言切换 UI。
export async function saveLocalePreference(endpoint: string, locale: Locale): Promise<void> {
  try {
    await fetchRecutJSON(endpoint, "/v1/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale }),
    });
  } catch {
    // 网络/服务不可用时语言仍在本地生效并持久化到 localStorage。
  }
}
