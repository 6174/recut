"use client";

/**
 * [INPUT]: 依赖 Recut service 同源 REST 接口（GET/PATCH /v1/projects/:id）与 i18n locale。
 * [OUTPUT]: 对外提供 useHostProject；宿主项目名是项目名称的唯一真相源，挂载时读取最新名称，rename 经 PATCH 写回宿主（与顶栏 EditableProjectName 同一接口）。
 * [POS]: recut 的项目名集成层；demo 模式或无 projectId 时返回空值，调用方回退编辑器内部文档名。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useCallback, useEffect, useState } from "react";
import { isDemoMode } from "@/demo/demo-store";
import { getRecutLocale } from "@/i18n";

function hostProjectURL({ projectId }: { projectId: string }) {
	return `/v1/projects/${encodeURIComponent(projectId)}`;
}

export function useHostProject({ projectId }: { projectId: string }) {
	const [name, setName] = useState<string | null>(null);

	// 每次面板挂载（选中态变化）都取最新宿主名，保证与顶栏保持一致。
	useEffect(() => {
		if (!projectId || isDemoMode()) return;
		let cancelled = false;
		fetch(hostProjectURL({ projectId }), {
			headers: { "Accept-Language": getRecutLocale() === "zh" ? "zh-CN" : "en" },
		})
			.then((response) => (response.ok ? response.json() : null))
			.then((project) => {
				if (!cancelled && project && typeof project.name === "string") {
					setName(project.name);
				}
			})
			.catch(() => {
				// 宿主不可达时保持 null，调用方回退文档名。
			});
		return () => {
			cancelled = true;
		};
	}, [projectId]);

	const rename = useCallback(
		async (nextName: string) => {
			const trimmed = nextName.trim();
			if (!projectId || !trimmed || isDemoMode()) return null;
			const response = await fetch(hostProjectURL({ projectId }), {
				method: "PATCH",
				headers: {
					"Content-Type": "application/json",
					"Accept-Language": getRecutLocale() === "zh" ? "zh-CN" : "en",
				},
				body: JSON.stringify({ name: trimmed }),
			});
			if (!response.ok) {
				throw new Error(`host project rename failed: ${response.status}`);
			}
			const project = await response.json();
			if (project && typeof project.name === "string") {
				setName(project.name);
			}
			return trimmed;
		},
		[projectId],
	);

	return { name, rename };
}
