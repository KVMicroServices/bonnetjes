import path from "node:path";
import { logger } from "@/lib/logger";

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_SCALE = 2.0;
const MAX_PAGES_TO_CONVERT = 3;

// ─── Asset paths ─────────────────────────────────────────────────────────────

interface PdfjsAssetPaths {
  standardFontDataUrl: string;
  cMapUrl: string;
}

let cachedAssetPaths: PdfjsAssetPaths | null = null;

/**
 * Resolve pdfjs-dist's bundled standard fonts and cMaps as absolute filesystem
 * paths with trailing separators.
 *
 * In Node, pdfjs-dist's binary data factory ultimately calls `fs.readFile(url)`,
 * which accepts plain absolute paths but does NOT accept `file://` URL strings,
 * so we deliberately pass raw paths. pdfjs only validates that the value is a
 * string ending with `/`.
 *
 * The path is computed at runtime from `process.cwd()` to keep webpack from
 * statically resolving `pdfjs-dist` and replacing the call with a numeric
 * module id (which previously broke production builds).
 */
function getPdfjsAssetPaths(): PdfjsAssetPaths {
  if (cachedAssetPaths !== null) {
    return cachedAssetPaths;
  }

  const packageRoot = path.join(process.cwd(), "node_modules", "pdfjs-dist");
  const fontsDir = path.join(packageRoot, "standard_fonts") + path.sep;
  const cmapsDir = path.join(packageRoot, "cmaps") + path.sep;

  cachedAssetPaths = {
    standardFontDataUrl: fontsDir,
    cMapUrl: cmapsDir
  };

  return cachedAssetPaths;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PdfPageImage {
  pageNumber: number;
  pngBuffer: Buffer;
}

export interface PdfConversionResult {
  success: true;
  pages: ReadonlyArray<PdfPageImage>;
}

export interface PdfConversionError {
  success: false;
  error: string;
}

export type PdfToImageResult = PdfConversionResult | PdfConversionError;

interface CanvasFactoryHandle {
  canvas: { width: number; height: number; toBuffer(mime: string): Buffer };
  context: unknown;
}

interface CanvasFactory {
  create(width: number, height: number): CanvasFactoryHandle;
  destroy(handle: CanvasFactoryHandle): void;
}

// ─── PDF Conversion ──────────────────────────────────────────────────────────

/**
 * Convert a PDF buffer into PNG image buffers (one per page, up to MAX_PAGES_TO_CONVERT).
 *
 * Rendering uses the canvas factory provided by pdfjs-dist itself, which is
 * backed by the `@napi-rs/canvas` copy nested inside `pdfjs-dist/node_modules`.
 * Mixing that with a top-level `@napi-rs/canvas` of a different version causes
 * `Path2D` instances to be rejected at render time with a NAPI type-validation
 * error, so we no longer create the canvas ourselves.
 */
export async function convertPdfToImages(
  pdfBuffer: Buffer,
  scale: number = DEFAULT_SCALE
): Promise<PdfToImageResult> {
  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const assetPaths = getPdfjsAssetPaths();

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      useSystemFonts: false,
      disableFontFace: true,
      standardFontDataUrl: assetPaths.standardFontDataUrl,
      cMapUrl: assetPaths.cMapUrl,
      cMapPacked: true
    });

    const pdfDocument = await loadingTask.promise;
    const canvasFactory = pdfDocument.canvasFactory as unknown as CanvasFactory;
    const totalPages = pdfDocument.numPages;
    const pagesToConvert = Math.min(totalPages, MAX_PAGES_TO_CONVERT);

    const pages: PdfPageImage[] = [];

    for (let pageIndex = 1; pageIndex <= pagesToConvert; pageIndex++) {
      const page = await pdfDocument.getPage(pageIndex);
      const viewport = page.getViewport({ scale });

      const canvasWidth = Math.floor(viewport.width);
      const canvasHeight = Math.floor(viewport.height);
      const handle = canvasFactory.create(canvasWidth, canvasHeight);

      try {
        const renderTask = page.render({
          canvasContext: handle.context as CanvasRenderingContext2D,
          canvas: handle.canvas as unknown as HTMLCanvasElement,
          viewport
        });

        await renderTask.promise;

        const pngBuffer = handle.canvas.toBuffer("image/png");

        pages.push({
          pageNumber: pageIndex,
          pngBuffer: Buffer.from(pngBuffer)
        });
      } finally {
        canvasFactory.destroy(handle);
      }
    }

    await pdfDocument.cleanup();
    await pdfDocument.destroy();

    logger.info(
      { totalPages, convertedPages: pagesToConvert },
      "PDF converted to images"
    );

    return { success: true, pages };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage }, "PDF to image conversion failed");
    return { success: false, error: errorMessage };
  }
}
