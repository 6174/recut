/**
 * [INPUT]: 依赖 modal.profiles.list/add/update/remove、modal.settings.set、modal.secrets.list/set 与 shadcn Dialog/Badge/Button/Input/Label、i18n
 * [OUTPUT]: 「Modal 账号与密钥」弹框：主视图只展示当前账号与账号列表（切换/编辑/删除 + 「+」），增改走二级弹框；Secret 已设置时只读打码展示、点「编辑」才出现输入框
 * [POS]: App 的账号与密钥设置面；打开时拉取 profiles 与 secrets，改动后回调刷新目录
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Check, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { interpolate, t, type Locale } from "../i18n";
import { recut } from "../recut-sdk";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { Profile, SecretDef } from "../types";

interface Props {
  locale: Locale;
  connected: boolean;
  account?: string;
  onClose: () => void;
  onChanged: () => void;
}

type Editor = { mode: "add" } | { mode: "edit"; profile: Profile };

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label className="text-xs/relaxed text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export function AccountDialog({ locale, connected, account, onClose, onChanged }: Props) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [defaultProfileId, setDefaultProfileId] = useState("");
  const [secrets, setSecrets] = useState<SecretDef[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorError, setEditorError] = useState("");
  const [name, setName] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [tokenSecret, setTokenSecret] = useState("");
  const [editingSecret, setEditingSecret] = useState("");
  const [savingSecret, setSavingSecret] = useState("");
  const [secretValues, setSecretValues] = useState<Record<string, Record<string, string>>>({});

  const call = useCallback(<T,>(op: string, input: Record<string, unknown> = {}) => recut.background.call(op, input) as Promise<T>, []);

  const refresh = useCallback(async () => {
    try {
      const [pl, sl] = await Promise.all([
        call<{ profiles: Profile[]; defaultProfileId: string }>("modal.profiles.list"),
        call<{ secrets: SecretDef[] }>("modal.secrets.list"),
      ]);
      setProfiles(pl.profiles ?? []);
      setDefaultProfileId(pl.defaultProfileId ?? "");
      setSecrets(sl.secrets ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [call]);

  useEffect(() => { void refresh(); }, [refresh]);

  // 执行一个会写状态的操作：成功刷新并回调，失败返回错误文案（由调用方决定展示在主弹框还是二级弹框）。
  // notify=false 用于「不影响账号身份」的写入（如保存 Secret）：刷新本面板即可，不必让外层重探各应用的账号态。
  const guard = async (action: () => Promise<void>, notify = true): Promise<string> => {
    setBusy(true);
    try {
      await action();
      await refresh();
      if (notify) onChanged();
      return "";
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    } finally {
      setBusy(false);
    }
  };

  const openAdd = () => { setEditorError(""); setName(""); setTokenId(""); setTokenSecret(""); setEditor({ mode: "add" }); };
  const openEdit = (profile: Profile) => { setEditorError(""); setName(profile.name); setTokenId(""); setTokenSecret(""); setEditor({ mode: "edit", profile }); };
  const closeEditor = () => { setEditor(null); setEditorError(""); };

  const submitEditor = async () => {
    if (!editor) return;
    const trimmedName = name.trim() || "default";
    const id = tokenId.trim();
    const secret = tokenSecret.trim();
    if (editor.mode === "add" && (!id || !secret)) { setEditorError(t(locale, "account.token-required")); return; }
    if (editor.mode === "edit" && Boolean(id) !== Boolean(secret)) { setEditorError(t(locale, "account.token-pair")); return; }
    const err = await guard(async () => {
      if (editor.mode === "add") {
        await call("modal.profiles.add", { name: trimmedName, tokenId: id, tokenSecret: secret, makeDefault: true });
      } else {
        const input: Record<string, unknown> = { id: editor.profile.id, name: trimmedName };
        if (id) { input.tokenId = id; input.tokenSecret = secret; }
        await call("modal.profiles.update", input);
      }
    });
    if (err) setEditorError(err);
    else closeEditor();
  };

  const switchProfile = async (id: string) => { setError(""); setError(await guard(async () => { await call("modal.settings.set", { defaultProfileId: id }); })); };
  const removeProfile = async (id: string) => { setError(""); setError(await guard(async () => { await call("modal.profiles.remove", { id }); })); };

  const saveSecret = async (secretName: string) => {
    setError("");
    const values = secretValues[secretName] ?? {};
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) if (v.trim()) clean[k] = v.trim();
    if (!Object.keys(clean).length) { setError(t(locale, "account.secret-empty")); return; }
    setSavingSecret(secretName);
    const err = await guard(async () => { await call("modal.secret.set", { name: secretName, values: clean }); }, false);
    setSavingSecret("");
    if (err) setError(err);
    else { setSecretValues((prev) => ({ ...prev, [secretName]: {} })); setEditingSecret(""); }
  };
  const cancelSecretEdit = (secretName: string) => {
    setSecretValues((prev) => ({ ...prev, [secretName]: {} }));
    setEditingSecret("");
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t(locale, "account.title")}</DialogTitle>
            <Badge variant="outline" className={connected ? "border-success/40 text-success" : "border-warning/40 text-warning"}>
              {connected ? t(locale, "connection.connected") : t(locale, "connection.disconnected")}
            </Badge>
            {account ? <span className="truncate text-[10px] text-muted-foreground">{account}</span> : null}
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto px-5 py-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold text-foreground">{t(locale, "account.profiles")}</p>
                <Button variant="outline" size="sm" disabled={busy} onClick={openAdd}><Plus className="size-3.5" />{t(locale, "account.profile-add")}</Button>
              </div>
              <p className="text-[10px] leading-4 text-muted-foreground">{t(locale, "account.profiles-hint")}</p>

              {profiles.length === 0 ? (
                <p className="rounded-md border border-dashed border-border/70 px-2.5 py-3 text-[11px] text-muted-foreground">{t(locale, "account.empty")}</p>
              ) : (
                <div className="space-y-1.5">
                  {profiles.map((profile) => {
                    const isCurrent = defaultProfileId === profile.id;
                    return (
                      <div key={profile.id} className={cn("flex items-center gap-2 rounded-md border px-2.5 py-2", isCurrent ? "border-border bg-secondary/40" : "border-border/70 bg-secondary/20")}>
                        <button
                          type="button"
                          disabled={busy || isCurrent}
                          onClick={() => void switchProfile(profile.id)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
                        >
                          <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">{profile.name}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">{profile.tokenIdMasked}</span>
                        </button>
                        {isCurrent ? (
                          <Badge variant="outline" className="border-success/40 text-success">{t(locale, "account.profile-current")}</Badge>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">{t(locale, "account.profile-switch")}</span>
                        )}
                        <Button variant="ghost" size="icon-sm" disabled={busy} title={t(locale, "account.profile-edit")} onClick={() => openEdit(profile)}><Pencil className="size-3.5" /></Button>
                        <Button variant="ghost" size="icon-sm" disabled={busy} title={t(locale, "account.profile-remove")} onClick={() => void removeProfile(profile.id)}><Trash2 className="size-3.5" /></Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-5 space-y-2">
              <p className="text-[11px] font-semibold text-foreground">{t(locale, "account.secrets")}</p>
              <p className="text-[10px] leading-4 text-muted-foreground">{t(locale, "account.secrets-hint")}</p>
              {secrets.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">—</p>
              ) : (
                secrets.map((secret) => {
                  const editing = editingSecret === secret.name;
                  const display = secret.set && !editing;
                  return (
                    <div key={secret.name} className="space-y-2 rounded-md border border-border/70 bg-secondary/30 p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">{secret.name}</span>
                        {secret.required ? <Badge variant="outline" className="border-warning/40 text-warning">{t(locale, "account.required")}</Badge> : null}
                        <Badge variant="outline" className={secret.set ? "border-success/40 text-success" : "text-muted-foreground"}>{secret.set ? t(locale, "account.secret-set") : t(locale, "account.secret-unset")}</Badge>
                      </div>
                      {display ? (
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate rounded-md border border-input bg-input/20 px-2 py-1.5 font-mono text-[11px] tracking-[0.2em] text-muted-foreground">••••••••••••</span>
                          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditingSecret(secret.name)}><Pencil className="size-3.5" />{t(locale, "account.secret-edit")}</Button>
                        </div>
                      ) : (
                        <>
                          {(secret.keys.length ? secret.keys : ["VALUE"]).map((key) => (
                            <Field key={key} label={key}>
                              <Input
                                type="password"
                                autoComplete="off"
                                spellCheck={false}
                                placeholder={interpolate(t(locale, "account.secret-placeholder"), { key })}
                                value={secretValues[secret.name]?.[key] ?? ""}
                                onChange={(e) => setSecretValues((prev) => ({ ...prev, [secret.name]: { ...(prev[secret.name] ?? {}), [key]: e.target.value } }))}
                              />
                            </Field>
                          ))}
                          <div className="flex items-center gap-2">
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => void saveSecret(secret.name)}>{savingSecret === secret.name ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}{t(locale, "account.secret-save")}</Button>
                            {editing ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => cancelSecretEdit(secret.name)}>{t(locale, "account.secret-cancel")}</Button> : null}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {error ? <p className="mt-3 text-[11px] text-destructive">{interpolate(t(locale, "account.error"), { error })}</p> : null}
          </div>
        </DialogContent>
      </Dialog>

      {editor ? (
        <Dialog open onOpenChange={(open) => { if (!open) closeEditor(); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t(locale, editor.mode === "add" ? "account.profile-add" : "account.profile-edit-title")}</DialogTitle>
            </DialogHeader>
            <div className="min-h-0 overflow-y-auto px-5 py-4">
              <p className="mb-3 text-[10px] leading-4 text-muted-foreground">
                {t(locale, editor.mode === "add" ? "account.editor-add-hint" : "account.editor-edit-hint")}
              </p>
              <div className="space-y-3">
                <Field label={t(locale, "account.profile-name")}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="default" /></Field>
                <Field label={t(locale, "account.token-id")}><Input value={tokenId} onChange={(e) => setTokenId(e.target.value)} autoComplete="off" spellCheck={false} placeholder={t(locale, "account.token-id-placeholder")} /></Field>
                <Field label={t(locale, "account.token-secret")}><Input type="password" value={tokenSecret} onChange={(e) => setTokenSecret(e.target.value)} autoComplete="off" spellCheck={false} placeholder={t(locale, "account.token-secret-placeholder")} /></Field>
              </div>
              {editorError ? <p className="mt-3 text-[11px] text-destructive">{interpolate(t(locale, "account.error"), { error: editorError })}</p> : null}
            </div>
            <DialogFooter>
              <Button variant="ghost" size="sm" disabled={busy} onClick={closeEditor}>{t(locale, "account.cancel")}</Button>
              <Button size="sm" disabled={busy} onClick={() => void submitEditor()}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : null}{t(locale, "account.profile-save")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
