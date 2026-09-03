import { DefinitionRegistry } from "@/params/registry";
import type { GraphicDefinition } from "./types";
import { t, type RecutLocale } from "@/i18n";

export class GraphicsRegistry extends DefinitionRegistry<string, GraphicDefinition> {
	constructor() {
		super("graphic");
	}
}

export const graphicsRegistry = new GraphicsRegistry();

export function getGraphicName({
	definition,
	locale,
}: {
	definition: GraphicDefinition;
	locale: RecutLocale;
}): string {
	return definition.nameKey ? t(locale, definition.nameKey) : definition.name;
}
