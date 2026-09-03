export const SITE_URL = "https://opencut.app";

import { assetPath } from "@/utils/base-path";

export const SITE_INFO = {
	title: "OpenCut",
	description:
		"A simple but powerful video editor that gets the job done. In your browser.",
	url: SITE_URL,
	openGraphImage: assetPath("/open-graph/default.jpg"),
	twitterImage: assetPath("/open-graph/default.jpg"),
	favicon: "/favicon.ico",
};

export const DEFAULT_LOGO_URL = assetPath("/logos/opencut/svg/logo.svg");
