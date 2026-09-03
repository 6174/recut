import type { AnchorHTMLAttributes, ReactNode } from "react";

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
	href: string;
	children?: ReactNode;
}

export default function Link({ href, children, ...props }: LinkProps) {
	return (
		<a href={href} {...props}>
			{children}
		</a>
	);
}
