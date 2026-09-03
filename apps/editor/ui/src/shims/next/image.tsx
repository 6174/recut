import type { ImgHTMLAttributes } from "react";

interface ImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
	src: string;
	alt?: string;
	fill?: boolean;
	width?: number;
	height?: number;
	sizes?: string;
	priority?: boolean;
	unoptimized?: boolean;
	onLoadingComplete?: (img: HTMLImageElement) => void;
}

export default function Image({
	src,
	alt = "",
	fill,
	width,
	height,
	style,
	onLoadingComplete,
	...props
}: ImageProps) {
	const mergedStyle: React.CSSProperties = fill
		? { position: "absolute", inset: 0, width: "100%", height: "100%", ...style }
		: style;
	return (
		<img
			src={src}
			alt={alt}
			width={fill ? undefined : width}
			height={fill ? undefined : height}
			style={mergedStyle}
			onLoad={(e) => onLoadingComplete?.(e.currentTarget)}
			{...props}
		/>
	);
}
