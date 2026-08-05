import React from "react";
import { Img } from "remotion";
import { AssetKind, MediaMap } from "./types";

export const mediaSrc = (media: MediaMap, assetId?: string): string | undefined => {
  if (!assetId || !media[assetId]) return undefined;
  const ref = media[assetId];
  return ref.url ?? ref.path;
};

export const mediaKind = (media: MediaMap, assetId?: string): AssetKind | undefined => {
  if (!assetId || !media[assetId]) return undefined;
  return media[assetId].kind;
};

export interface MediaImageProps {
  media: MediaMap;
  assetId?: string;
  style?: React.CSSProperties;
}

/** An <Img> that resolves a Recut assetId to its preview/render source. */
export const MediaImage: React.FC<MediaImageProps> = ({ media, assetId, style }) => {
  const src = mediaSrc(media, assetId);
  if (!src) return null;
  return <Img src={src} style={style} />;
};
