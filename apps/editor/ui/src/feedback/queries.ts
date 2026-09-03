import { generateUUID } from "@/utils/id";
import type { FeedbackEntry, SubmitFeedbackInput } from "./types";

/** 本地客户端桩：不写入服务端 DB（Recut 编辑器内 feedback 走平台/离线丢弃）。 */
export async function submitFeedback({
	message,
}: SubmitFeedbackInput): Promise<FeedbackEntry> {
	const id = generateUUID();
	const now = new Date();
	console.info("[feedback] submitted (local only)", { id, message });
	return { id, message, createdAt: now.toISOString() };
}
