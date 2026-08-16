/*
 * [INPUT]: 依赖 locales.ts 的 Locale；由 apps store 面实施方扩充
 * [OUTPUT]: 工作台应用市场/安装/升级文案的逐语言字典；en 必须覆盖 zh 全部 key（Record<keyof typeof zh, string> 编译期保证）
 * [POS]: web/lib/i18n 的 appstore 命名空间；合并进 workspaceDictionary，appstore 相关组件消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Locale } from "./locales";

const zh = {
  "appstore.placeholder": "应用市场",

  // App 详情页
  "appstore.detail.loading": "正在读取应用信息…",
  "appstore.detail.notFound": "这个 App 不在应用中心，也没有在当前 service 中找到本地安装包。",
  "appstore.detail.offline": "这是本地安装的 App；连接 service 后才能读取它。",
  "appstore.detail.connectService": "连接 service",
  "appstore.detail.backToApps": "返回 Apps",
  "appstore.detail.type.project": "项目型 App",
  "appstore.detail.type.standalone": "工作区 App",
  "appstore.detail.author": "作者 {name}",
  "appstore.detail.status.standaloneInstalled": "已安装；直接打开即可复用同一组模板和历史。",
  "appstore.detail.status.projectInstalled": "此 App 已安装，可在本机安全升级。",
  "appstore.detail.status.notInstalled": "尚未安装。安装后即可使用。",
  "appstore.detail.status.offline": "连接 service 后可确认安装状态并安装此 App。",
  "appstore.detail.viewRepo": "查看仓库",

  // 安装
  "appstore.install.title": "安装此 App",
  "appstore.install.desc": "安装后才会把它加入你的本地工作台。",
  "appstore.install.button": "安装 App",
  "appstore.install.installing": "正在安装…",
  "appstore.install.needService": "安装 App 前，请先配置并连接一个 service。",
  "appstore.install.failed": "安装 App 失败",

  // 用 App 创建项目
  "appstore.create.title": "用此 App 创建项目",
  "appstore.create.desc": "项目会绑定当前已安装版本的 {name}。",
  "appstore.create.nameLabel": "项目名称",
  "appstore.create.namePlaceholder": "例如：夏季品牌片",
  "appstore.create.submit": "创建项目",
  "appstore.create.creating": "正在创建…",
  "appstore.create.failed": "创建项目失败",

  // 直接打开工作区
  "appstore.workspace.title": "直接打开工作区",
  "appstore.workspace.desc": "模板、参考图选择和历史封面会持续保留，但不会创建项目。",
  "appstore.workspace.open": "打开 App",

  // 版本升级错误提示的语句连接符（错误信息与服务诊断后缀之间）
  "appstore.version.errorJoiner": "。",
} as const;

const en: Record<keyof typeof zh, string> = {
  "appstore.placeholder": "App Store",

  // App detail page
  "appstore.detail.loading": "Loading app info…",
  "appstore.detail.notFound": "This app isn't in the App Store, and no local install was found in the current service.",
  "appstore.detail.offline": "This is a locally installed app; connect a service to read it.",
  "appstore.detail.connectService": "Connect service",
  "appstore.detail.backToApps": "Back to Apps",
  "appstore.detail.type.project": "Project app",
  "appstore.detail.type.standalone": "Workspace app",
  "appstore.detail.author": "by {name}",
  "appstore.detail.status.standaloneInstalled": "Installed. Open it directly to reuse the same templates and history.",
  "appstore.detail.status.projectInstalled": "This app is installed and can be safely upgraded on this machine.",
  "appstore.detail.status.notInstalled": "Not installed yet. Install it to start using it.",
  "appstore.detail.status.offline": "Connect a service to confirm the install status and install this app.",
  "appstore.detail.viewRepo": "View repository",

  // Install
  "appstore.install.title": "Install this app",
  "appstore.install.desc": "It's only added to your local workspace after install.",
  "appstore.install.button": "Install app",
  "appstore.install.installing": "Installing…",
  "appstore.install.needService": "Configure and connect a service before installing apps.",
  "appstore.install.failed": "Failed to install app",

  // Create a project with an app
  "appstore.create.title": "Create a project with this app",
  "appstore.create.desc": "The project will bind to the currently installed version of {name}.",
  "appstore.create.nameLabel": "Project name",
  "appstore.create.namePlaceholder": "e.g. Summer brand film",
  "appstore.create.submit": "Create project",
  "appstore.create.creating": "Creating…",
  "appstore.create.failed": "Failed to create project",

  // Open the workspace directly
  "appstore.workspace.title": "Open the workspace directly",
  "appstore.workspace.desc": "Templates, reference selection and cover history persist, but no project is created.",
  "appstore.workspace.open": "Open app",

  // Joiner between an upgrade error message and the service diagnostics suffix
  "appstore.version.errorJoiner": ". ",
} as const;

export const appstoreZh = zh;
export const appstoreEn = en;
export type AppStoreDictionary = Record<Locale, typeof zh>;
