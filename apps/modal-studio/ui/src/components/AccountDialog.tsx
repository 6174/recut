/**
 * [INPUT]: 依赖 modal.profiles.list/add/remove、modal.settings.set、modal.secrets.list/set 与共享视觉原子、i18n
 * [OUTPUT]: 右上角「Modal 账号」面板：管理多个 modal token profile（增删/默认）+ 按预设包声明的 Secret 渲染 token/密钥设置项（如 HF_TOKEN）并写入用户 Modal 账号
 * [POS]: App 的账号与密钥设置面；打开时拉取 profiles 与 secrets，改动后回调刷新目录
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Plus, Trash2, X } from "lucide-react";
import { interpolate, t, type Locale } from "../i18n";
import { recut } from "../recut-sdk";
import { Badge, Button, Field, Input } from "../ui";
import type { Profile, SecretDef } from "../types";

interface Props {
  locale: Locale;
  connected: boolean;
  account?: string;
  onClose: () => void;
  onChanged: () => void;
}

export function AccountDialog({ locale, connected, account, onClose, onChanged }: Props) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [defaultProfileId, setDefaultProfileId] = useState("");
  const [secrets, setSecrets] = useState<SecretDef[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("default");
  const [tokenId, setTokenId] = useState("");
  const [tokenSecret, setTokenSecret] = useState("");
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

  const guard = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addProfile = () => guard(async () => {
    if (!tokenId.trim() || !tokenSecret.trim()) throw new Error("tokenId / tokenSecret");
    await call("modal.profiles.add", { name: name.trim() || "default", tokenId: tokenId.trim(), tokenSecret: tokenSecret.trim(), makeDefault: true });
    setTokenId(""); setTokenSecret("");
  });
  const removeProfile = (id: string) => guard(async () => { await call("modal.profiles.remove", { id }); });
  const setDefault = (id: string) => guard(async () => { await call("modal.settings.set", { defaultProfileId: id }); });
  const saveSecret = (secretName: string) => guard(async () => {
    const values = secretValues[secretName] ?? {};
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) if (v.trim()) clean[k] = v.trim();
    if (!Object.keys(clean).length) throw new Error("values");
    await call("modal.secret.set", { name: secretName, values: clean });
    setSecretValues((prev) => ({ ...prev, [secretName]: {} }));
  });

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <section className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">{t(locale, "account.title")}</h2>
          <Badge tone={connected ? "success" : "warning"}>{connected ? t(locale, "connection.connected") : t(locale, "connection.disconnected")}</Badge>
          {account ? <span className="truncate text-[10px] text-muted-foreground">{account}</span> : null}
          <span className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onClose}><X className="size-3.5" />{t(locale, "account.close")}</Button>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-foreground">{t(locale, "account.profiles")}</p>
          <p className="text-[10px] leading-4 text-muted-foreground">{t(locale, "account.profiles-hint")}</p>
          {profiles.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">—</p>
          ) : (
            <div className="space-y-1.5">
              {profiles.map((profile) => (
                <div key={profile.id} className="flex items-center gap-2 rounded-md border border-border/70 bg-secondary/30 px-2.5 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">{profile.name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{profile.tokenIdMasked}</span>
                  {defaultProfileId === profile.id ? (
                    <Badge tone="primary">{t(locale, "account.profile-default")}</Badge>
                  ) : (
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => void setDefault(profile.id)}>{t(locale, "account.profile-set-default")}</Button>
                  )}
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void removeProfile(profile.id)}><Trash2 className="size-3.5" /></Button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2 rounded-md border border-dashed border-border/70 p-2.5">
            <p className="text-[10px] font-medium text-muted-foreground">{t(locale, "account.profile-add")}</p>
            <Field label={t(locale, "account.profile-name")}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="default" /></Field>
            <Field label={t(locale, "account.token-id")}><Input value={tokenId} onChange={(e) => setTokenId(e.target.value)} autoComplete="off" spellCheck={false} /></Field>
            <Field label={t(locale, "account.token-secret")}><Input type="password" value={tokenSecret} onChange={(e) => setTokenSecret(e.target.value)} autoComplete="off" spellCheck={false} /></Field>
            <Button size="sm" disabled={busy} onClick={() => void addProfile()}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}{t(locale, "account.profile-add-submit")}</Button>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <p className="text-[11px] font-semibold text-foreground">{t(locale, "account.secrets")}</p>
          <p className="text-[10px] leading-4 text-muted-foreground">{t(locale, "account.secrets-hint")}</p>
          {secrets.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">—</p>
          ) : (
            secrets.map((secret) => (
              <div key={secret.name} className="space-y-2 rounded-md border border-border/70 bg-secondary/30 p-2.5">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">{secret.name}</span>
                  {secret.required ? <Badge tone="warning">{t(locale, "account.required")}</Badge> : null}
                  <Badge tone={secret.set ? "success" : "muted"}>{secret.set ? t(locale, "account.secret-set") : t(locale, "account.secret-unset")}</Badge>
                </div>
                {(secret.keys.length ? secret.keys : ["VALUE"]).map((key) => (
                  <Field key={key} label={key}>
                    <Input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={secretValues[secret.name]?.[key] ?? ""}
                      onChange={(e) => setSecretValues((prev) => ({ ...prev, [secret.name]: { ...(prev[secret.name] ?? {}), [key]: e.target.value } }))}
                    />
                  </Field>
                ))}
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void saveSecret(secret.name)}><Check className="size-3.5" />{t(locale, "account.secret-save")}</Button>
              </div>
            ))
          )}
        </div>

        {error ? <p className="mt-3 text-[11px] text-destructive">{interpolate(t(locale, "account.error"), { error })}</p> : null}
      </section>
    </div>
  );
}
