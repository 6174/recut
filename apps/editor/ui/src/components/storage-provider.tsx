"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { t, getRecutLocale } from "@/i18n";
import { useEditor } from "@/editor/use-editor";
import { storageService } from "@/services/storage/service";

interface StorageContextType {
	isInitialized: boolean;
	isLoading: boolean;
	hasSupport: boolean;
	error: string | null;
}

const StorageContext = createContext<StorageContextType | null>(null);

export function useStorage() {
	const context = useContext(StorageContext);
	if (!context) {
		throw new Error("useStorage must be used within StorageProvider");
	}
	return context;
}

interface StorageProviderProps {
	children: React.ReactNode;
}

export function StorageProvider({ children }: StorageProviderProps) {
	const [status, setStatus] = useState<StorageContextType>({
		isInitialized: false,
		isLoading: true,
		hasSupport: false,
		error: null,
	});

	const editor = useEditor();
	const hasInitialized = useRef(false);

	useEffect(() => {
		if (hasInitialized.current) return;
		hasInitialized.current = true;

		const initializeStorage = async () => {
			setStatus((prev) => ({ ...prev, isLoading: true }));

			try {
				const hasSupport = storageService.isFullySupported();

				if (!hasSupport) {
					toast.warning(t(getRecutLocale(), "storage.notSupported"));
				}

				await editor.project.loadAllProjects();

				setStatus({
					isInitialized: true,
					isLoading: false,
					hasSupport,
					error: null,
				});
			} catch (error) {
				console.error("Failed to initialize storage:", error);
				setStatus({
					isInitialized: false,
					isLoading: false,
					hasSupport: storageService.isFullySupported(),
					error: error instanceof Error ? error.message : "Unknown error",
				});
			}
		};

		initializeStorage();
	}, [editor.project.loadAllProjects]);

	return (
		<StorageContext.Provider value={status}>{children}</StorageContext.Provider>
	);
}
