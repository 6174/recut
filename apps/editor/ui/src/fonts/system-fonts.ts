/**
 * 跨平台常用系统字体（含中文字体）。这些 family 名直接以 CSS font-family 使用，
 * 本机浏览器原生可用，无需加载/注册。macOS/Windows 各自实际安装情况由
 * queryLocalFonts() 枚举补充（见 local-fonts.ts）。
 */
export const SYSTEM_FONTS = new Set([
	// 拉丁常用
	"Arial",
	"Helvetica",
	"Times New Roman",
	"Courier New",
	"Verdana",
	"Georgia",
	"monospace",
	"sans-serif",
	"serif",
	// macOS 中文字体
	"PingFang SC",
	"PingFang HK",
	"Hiragino Sans GB",
	"Hiragino Mincho ProN",
	"Songti SC",
	"Songti TC",
	"STSong",
	"STHeiti",
	"STKaiti",
	"STFangsong",
	"Kaiti SC",
	"Baoli SC",
	"Yuanti SC",
	"LXGW WenKai",
	// Windows 中文字体
	"Microsoft YaHei",
	"Microsoft YaHei UI",
	"SimHei",
	"SimSun",
	"NSimSun",
	"KaiTi",
	"FangSong",
	"DengXian",
	// 开源中文字体（用户手动安装场景）
	"Source Han Sans CN",
	"Source Han Serif CN",
	"Source Han Sans SC",
	"Source Han Serif SC",
	"Noto Sans CJK SC",
	"Noto Serif CJK SC",
	"HarmonyOS Sans SC",
	"MiSans",
	"OPPO Sans",
	"Alibaba PuHuiTi",
]);
