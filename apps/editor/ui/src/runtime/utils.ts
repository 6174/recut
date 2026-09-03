import type { ParamValue } from "@/params";

export function num(value: ParamValue | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function str(value: ParamValue | undefined, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

export function bool(value: ParamValue | undefined, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}
