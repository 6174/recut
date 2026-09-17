import { useMemo } from "react";

function parseParams(): Record<string, string> {
	const query = new URLSearchParams(window.location.search);
	const fromQuery = query.get("projectId");
	if (fromQuery) {
		return { project_id: fromQuery };
	}
	const path = window.location.pathname;
	const matches = path.match(/\/projects\/([^/]+)/);
	return { project_id: matches?.[1] ?? "" };
}

export function useParams<T extends Record<string, string | string[]>>(): T {
	return useMemo(() => parseParams() as unknown as T, []);
}

export function usePathname(): string {
	return window.location.pathname;
}

export function useSearchParams(): URLSearchParams {
	return new URLSearchParams(window.location.search);
}

export function useRouter() {
	return useMemo(
		() => ({
			push: (href: string) => {
				window.location.assign(href);
			},
			replace: (href: string) => {
				window.location.replace(href);
			},
			refresh: () => {},
			back: () => window.history.back(),
			forward: () => window.history.forward(),
			prefetch: () => {},
		}),
		[],
	);
}

export function redirect(href: string): never {
	window.location.assign(href);
	throw new Error(`redirect to ${href}`);
}
