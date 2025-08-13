/// <reference types="vite/client" />
import type React from "react";
import { useCallback, useRef, useState } from "react";
import JSZip from "jszip";

// Use the legacy build for widest compatibility + access to OPS/ImageKind
// and wire up the Web Worker cleanly in Vite.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf";
pdfjs.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL || "/"}pdf.worker.min.mjs`;

import "./index.css";

type Extracted = {
	id: string;
	pageIndex: number;
	width: number;
	height: number;
	blob: Blob;
	url: string;
	format: "png";
};

const Dropzone: React.FC<{ onFiles: (files: FileList) => void }> = ({
	onFiles,
}) => {
	const [dragOver, setDragOver] = useState(false);
	return (
		<div
			onDragOver={(e) => {
				e.preventDefault();
				setDragOver(true);
			}}
			onDragLeave={() => setDragOver(false)}
			onDrop={(e) => {
				e.preventDefault();
				setDragOver(false);
				if (e.dataTransfer?.files?.length) onFiles(e.dataTransfer.files);
			}}
			className={
				"mt-4 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition " +
				(dragOver ? "border-blue-500 bg-blue-50" : "border-gray-300 bg-white")
			}
		>
			<p className="text-lg font-medium">Drag & drop your PDF here</p>
			<p className="text-sm text-gray-500 mt-1">
				or click the button below to choose a file
			</p>
		</div>
	);
};

export default function App() {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [images, setImages] = useState<Extracted[]>([]);
	const [meta, setMeta] = useState<{ pages: number; filename?: string } | null>(
		null,
	);
	const fileRef = useRef<HTMLInputElement>(null);

	const reset = () => {
		setImages([]);
		setMeta(null);
		setError(null);
	};

	const handleFiles = useCallback(
		async (files: FileList) => {
			const file = Array.from(files).find(
				(f) =>
					f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
			);
			if (!file) {
				setError("Please select a PDF file.");
				return;
			}
			reset();
			setBusy(true);
			try {
				const ab = await file.arrayBuffer();
				const loadingTask = pdfjs.getDocument({ data: ab });
				const pdf = await loadingTask.promise;
				setMeta({ pages: pdf.numPages, filename: file.name });

				const allExtracted: Extracted[] = [];

				for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex++) {
					const page = await pdf.getPage(pageIndex);

					// Render once to populate page.objs (where decoded images live)
					const viewport = page.getViewport({ scale: 1 });
					const canvas = document.createElement("canvas");
					const ctx = canvas.getContext("2d", { willReadFrequently: false });
					if (!ctx) throw new Error("Canvas 2D not available");
					canvas.width = Math.max(1, Math.floor(viewport.width));
					canvas.height = Math.max(1, Math.floor(viewport.height));
					await page.render({ canvasContext: ctx, viewport }).promise;

					// Inspect internal object store for decoded images.
					// NOTE: This uses pdf.js internals (page.objs._objs). It works in the browser
					// but is not part of the public API. For a client-only extractor this is acceptable.
					// We filter only objects that look like decoded image data.
					// @ts-ignore - internal access
					const store = page.objs && page.objs._objs ? page.objs._objs : {};

					// Debug: log all object keys and types for this page
					console.log(`PDF page ${pageIndex} object keys:`, Object.keys(store));
					for (const [k, v] of Object.entries(store)) {
						if (v && typeof v === "object") {
							console.log(`  [${k}] keys:`, Object.keys(v));
						}
					}

					const candidates: Array<[string, any]> = Object.entries(store).filter(
						([_, v]) =>
							v &&
							typeof v === "object" &&
							"data" in v &&
							"width" in v &&
							"height" in v,
					);

					for (const [id, img] of candidates) {
						try {
							const { width, height, data } = img as {
								width: number;
								height: number;
								data: Uint8ClampedArray;
							};
							if (!width || !height || !data) continue;

							// Draw raw RGBA data onto a fresh canvas to isolate the image
							const c = document.createElement("canvas");
							c.width = width;
							c.height = height;
							const c2d = c.getContext("2d");
							if (!c2d) continue;
							const imageData = new ImageData(
								new Uint8ClampedArray(data),
								width,
								height,
							);
							c2d.putImageData(imageData, 0, 0);

							const blob: Blob = await new Promise((res) =>
								c.toBlob((b) => res(b!), "image/png"),
							);
							const url = URL.createObjectURL(blob);

							allExtracted.push({
								id: `${pageIndex}-${id}`,
								pageIndex,
								width,
								height,
								blob,
								url,
								format: "png",
							});
						} catch (e) {
							// Skip non-image entries or decode failures
							console.warn("Skip candidate image:", e);
						}
					}
				}

				// Deduplicate by width/height/url length heuristic (pdf.js may store variants)
				const unique: Extracted[] = [];
				const seen = new Set<string>();
				for (const img of allExtracted) {
					const key = `${img.pageIndex}:${img.width}x${img.height}`;
					if (seen.has(key)) continue;
					seen.add(key);
					unique.push(img);
				}

				if (unique.length === 0) {
					// Fallback: rasterize each page as PNG if no embedded images found
					for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex++) {
						const page = await pdf.getPage(pageIndex);
						const viewport = page.getViewport({ scale: 2 }); // higher res for raster
						const canvas = document.createElement("canvas");
						const ctx = canvas.getContext("2d");
						if (!ctx) continue;
						canvas.width = Math.max(1, Math.floor(viewport.width));
						canvas.height = Math.max(1, Math.floor(viewport.height));
						await page.render({ canvasContext: ctx, viewport }).promise;
						const blob: Blob = await new Promise((res) =>
							canvas.toBlob((b) => res(b!), "image/png"),
						);
						const url = URL.createObjectURL(blob);
						unique.push({
							id: `raster-page-${pageIndex}`,
							pageIndex,
							width: canvas.width,
							height: canvas.height,
							blob,
							url,
							format: "png",
						});
					}
					if (unique.length === 0) {
						setError(
							"No embedded images or rasterized pages could be extracted. (Some PDFs only have vector graphics or are encrypted.)",
						);
					} else {
						setError(
							"No embedded images were found. Fallback: rasterized each page as a PNG. This is not perfect extraction—vector graphics, text, and image quality may differ from the originals.",
						);
					}
				}
				setImages(unique);
			} catch (e: any) {
				console.error(e);
				setError(e?.message || "Failed to process PDF");
			} finally {
				setBusy(false);
			}
		},
		[reset],
	);

	const total = images.length;

	const downloadAll = useCallback(async () => {
		const zip = new JSZip();
		images.forEach((img, i) => {
			const name = `page-${img.pageIndex}_img-${i + 1}_${img.width}x${img.height}.${img.format}`;
			zip.file(name, img.blob);
		});
		const content = await zip.generateAsync({ type: "blob" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(content);
		a.download = (meta?.filename?.replace(/\.pdf$/i, "") || "images") + ".zip";
		a.click();
	}, [images, meta?.filename]);

	const onChoose = () => fileRef.current?.click();

	return (
		<div className="bg-gradient-to-br from-yellow-50 via-blue-50 to-pink-100">
			<div className="mx-auto max-w-5xl p-6 min-h-screen">
				<header className="mb-8 flex flex-col items-center text-center">
					<div className="flex items-center gap-3 mb-2">
						<span className="inline-block text-4xl md:text-5xl font-extrabold text-blue-700 drop-shadow-sm retro-outline">
							Picturific
						</span>
						<span className="inline-block rotate-6 text-3xl md:text-4xl">
								🕶️
						</span>
					</div>
					<div className="text-lg md:text-xl font-mono text-gray-700 mb-1">
						PDF Image Extraction, with Style
					</div>
					<div className="text-sm text-blue-600 italic">
						Runs 100% in your browser. No uploads.
					</div>
				</header>

				<div className="rounded-2xl bg-white/90 p-5 shadow-xl border-2 border-blue-200">
					<div className="flex items-center gap-3">
						<input
							ref={fileRef}
							type="file"
							accept="application/pdf"
							className="hidden"
							onChange={(e) => e.target.files && handleFiles(e.target.files)}
						/>
						<button
							onClick={onChoose}
							className="rounded-xl border bg-gray-900 px-4 py-2 text-white shadow hover:bg-black"
						>
							Choose PDF
						</button>
						<span className="text-sm text-gray-500">or drop a file below</span>
					</div>

					<Dropzone onFiles={handleFiles} />

					{busy && (
						<div className="mt-6">
							<div className="rounded-xl bg-gray-100 p-4 text-sm mb-4 animate-pulse">
								<div className="h-4 w-1/3 bg-gray-300 rounded mb-2" />
								<div className="h-3 w-1/2 bg-gray-200 rounded mb-1" />
								<div className="h-3 w-1/4 bg-gray-200 rounded" />
							</div>
							<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
								{Array.from({ length: 6 }).map((_, i) => (
									<div
										key={i}
										className="rounded-xl bg-white p-3 shadow border animate-pulse"
									>
										<div className="w-full h-40 bg-gray-200 rounded-md mb-2 shimmer" />
										<div className="h-3 w-2/3 bg-gray-200 rounded mb-1" />
										<div className="h-3 w-1/3 bg-gray-100 rounded" />
									</div>
								))}
							</div>
						</div>
					)}

					{error && !busy && (
						<div className="mt-6 rounded-xl bg-red-50 p-4 text-sm text-red-700 border border-red-200">
							{error}
						</div>
					)}

					{meta && !busy && (
						<div className="mt-6 flex items-center justify-between">
							<div className="text-sm text-gray-600">
								<strong>{meta.filename}</strong> · {meta.pages} page
								{meta.pages !== 1 ? "s" : ""} · {total} image
								{total !== 1 ? "s" : ""} found
							</div>
							{images.length > 0 && (
								<button
									onClick={downloadAll}
									className="rounded-xl border bg-blue-600 px-4 py-2 text-white shadow hover:bg-blue-700"
								>
									Download all as ZIP
								</button>
							)}
						</div>
					)}
				</div>

				{images.length > 0 && (
					<section className="mt-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
						{images.map((img, idx) => (
							<figure
								key={img.id}
								className="rounded-xl bg-white p-3 shadow border"
							>
								<img
									src={img.url}
									alt={`Extracted ${idx + 1}`}
									className="w-full h-auto rounded-md"
								/>
								<figcaption className="mt-2 text-xs text-gray-600 flex items-center justify-between">
									<span>
										Page {img.pageIndex} · {img.width}×{img.height}
									</span>
									<a
										href={img.url}
										download={`page-${img.pageIndex}_img-${idx + 1}_${img.width}x${img.height}.${img.format}`}
										className="underline hover:no-underline"
									>
										Download
									</a>
								</figcaption>
							</figure>
						))}
					</section>
				)}

				<footer className="mt-10 text-xs text-gray-700 text-center font-mono">
					<p>
						<span className="font-bold text-blue-700">Picturific</span> &copy;
						2025 · “Extracting images so good, you’ll want to frame them.”
						<br />
						<span className="text-gray-400">
							Tip: If a PDF only contains vector art or the images were
							flattened during creation, nothing may be extracted. You can still
							rasterize pages via your PDF tool if needed.
						</span>
					</p>
				</footer>
			</div>
		</div>
	);
}
