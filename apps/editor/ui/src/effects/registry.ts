import { DefinitionRegistry } from "@/params/registry";
import type { EffectDefinition } from "@/effects/types";
import { t, type RecutLocale } from "@/i18n";

export class EffectsRegistry extends DefinitionRegistry<string, EffectDefinition> {
	constructor() {
		super("effect");
	}
}

export const effectsRegistry = new EffectsRegistry();

export function getEffectName({
	definition,
	locale,
}: {
	definition: EffectDefinition;
	locale: RecutLocale;
}): string {
	return definition.nameKey ? t(locale, definition.nameKey) : definition.name;
}
