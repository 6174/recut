import type { ComponentRenderContext } from "../types";
import { useImageTexture } from "../texture";
import { Plane } from "./plane";

export function ImageObject({ world, object, params }: ComponentRenderContext) {
	const texture = useImageTexture(object.url);
	return <Plane world={world} object={object} params={params} map={texture} />;
}
