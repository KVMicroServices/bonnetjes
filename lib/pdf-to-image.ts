import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { logger } from "@/lib/logger";

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_SCALE = 2.0;
const MAX_PAGES_TO_CONVERT = 3;

const requireFromHere = createRequire(import.meta.url);
const PDFJS_PACKAGE_ROOT = path.dirname(
  requireFromHere.resolve("pdfjs-dist/package.json")
);
const STANDARD_FONT_DATA_URL =
  pathToFileURL(path.join(PDFJS_PACKAGE_ROOT, "standard_fonts") + path.sep).href;
const CMAP_URL =
  pathToFileURL(path.join(PDFJS_PACKAGE_ROOT, "cmaps") + path.sep).href;

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

// ─── PDF Conversion ──────────────────────────────────────────────────────────

/**
 * Convert a PDF buffer into PNG image buffers (one per page, up to MAX_PAGES_TO_CONVERT).
 * Uses pdfjs-dist for parsing and @napi-rs/canvas for rendering.
 */
export async function convertPdfToImages(
  pdfBuffer: Buffer,
  scale: number = DEFAULT_SCALE
): Promise<PdfToImageResult> {
  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      useSystemFonts: false,
      disableFontFace: true,
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
      cMapUrl: CMAP_URL,
      cMapPacked: true
    });

    const pdfDocument = await loadingTask.promise;
    const totalPages = pdfDocument.numPages;
    const pagesToConvert = Math.min(totalPages, MAX_PAGES_TO_CONVERT);

    const pages: PdfPageImage[] = [];

    for (let pageIndex = 1; pageIndex <= pagesToConvert; pageIndex++) {
      const page = await pdfDocument.getPage(pageIndex);
      const viewport = page.getViewport({ scale });

      const canvasWidth = Math.floor(viewport.width);
      const canvasHeight = Math.floor(viewport.height);
      const canvas = createCanvas(canvasWidth, canvasHeight);
      const context = canvas.getContext("2d");

      const renderContext = {
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
        canvas: null
      };

      await page.render(renderContext).promise;

      const pngBuffer = canvas.toBuffer("image/png");

      pages.push({
        pageNumber: pageIndex,
        pngBuffer: Buffer.from(pngBuffer)
      });
    }

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
