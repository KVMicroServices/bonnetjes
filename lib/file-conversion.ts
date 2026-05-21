import { execFile } from "node:child_process";
import { writeFile, readFile, unlink, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { logger } from "@/lib/logger";

// ─── Constants ───────────────────────────────────────────────────────────────

const HEIC_JPEG_QUALITY = 0.9;
const LIBREOFFICE_TIMEOUT_MILLISECONDS = 30000;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConversionResult {
  success: true;
  buffer: Buffer;
  mimeType: string;
  extension: string;
}

export interface ConversionError {
  success: false;
  error: string;
}

export type FileConversionResult = ConversionResult | ConversionError;

// ─── Format Detection ────────────────────────────────────────────────────────

const HEIC_EXTENSIONS = [".heic", ".heif"];
const DOC_EXTENSIONS = [".doc"];
const DOCX_EXTENSIONS = [".docx"];

export function isHeicFile(filename: string): boolean {
  const extension = path.extname(filename).toLowerCase();
  return HEIC_EXTENSIONS.includes(extension);
}

export function isDocFile(filename: string): boolean {
  const extension = path.extname(filename).toLowerCase();
  return DOC_EXTENSIONS.includes(extension);
}

export function isDocxFile(filename: string): boolean {
  const extension = path.extname(filename).toLowerCase();
  return DOCX_EXTENSIONS.includes(extension);
}

export function needsConversion(filename: string): boolean {
  return isHeicFile(filename) || isDocFile(filename) || isDocxFile(filename);
}

// ─── HEIC Conversion ─────────────────────────────────────────────────────────

async function convertHeicToJpeg(fileBuffer: Buffer): Promise<FileConversionResult> {
  try {
    const heicConvert = await import("heic-convert");
    const convertFunction = heicConvert.default || heicConvert;

    const outputBuffer = await convertFunction({
      buffer: fileBuffer,
      format: "JPEG",
      quality: HEIC_JPEG_QUALITY,
    });

    const resultBuffer = Buffer.from(outputBuffer);

    logger.info(
      { inputSize: fileBuffer.length, outputSize: resultBuffer.length },
      "HEIC converted to JPEG"
    );

    return {
      success: true,
      buffer: resultBuffer,
      mimeType: "image/jpeg",
      extension: ".jpg",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage }, "HEIC to JPEG conversion failed");
    return { success: false, error: `HEIC conversion failed: ${errorMessage}` };
  }
}

// ─── DOC Conversion (via LibreOffice) ────────────────────────────────────────

async function convertDocToPdf(fileBuffer: Buffer, filename: string): Promise<FileConversionResult> {
  let temporaryDirectory = "";

  try {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "doc-convert-"));
    const inputPath = path.join(temporaryDirectory, filename);
    await writeFile(inputPath, fileBuffer);

    await new Promise<void>((resolve, reject) => {
      execFile(
        "libreoffice",
        [
          "--headless",
          "--convert-to",
          "pdf",
          "--outdir",
          temporaryDirectory,
          inputPath,
        ],
        { timeout: LIBREOFFICE_TIMEOUT_MILLISECONDS },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`LibreOffice conversion failed: ${stderr || error.message}`));
            return;
          }
          resolve();
        }
      );
    });

    const baseName = path.basename(filename, path.extname(filename));
    const outputPath = path.join(temporaryDirectory, `${baseName}.pdf`);
    const pdfBuffer = await readFile(outputPath);

    logger.info(
      { inputSize: fileBuffer.length, outputSize: pdfBuffer.length, filename },
      "DOC converted to PDF via LibreOffice"
    );

    return {
      success: true,
      buffer: pdfBuffer,
      mimeType: "application/pdf",
      extension: ".pdf",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage, filename }, "DOC to PDF conversion failed");
    return { success: false, error: `DOC conversion failed: ${errorMessage}` };
  } finally {
    if (temporaryDirectory.length > 0) {
      await cleanupTemporaryDirectory(temporaryDirectory).catch(() => {});
    }
  }
}

// ─── DOCX Conversion (via mammoth + canvas) ─────────────────────────────────

async function convertDocxToImages(fileBuffer: Buffer): Promise<FileConversionResult> {
  try {
    const mammoth = await import("mammoth");

    const result = await mammoth.convertToHtml({ buffer: fileBuffer });
    const htmlContent = result.value;

    if (htmlContent.trim().length === 0) {
      return { success: false, error: "DOCX file contains no readable content" };
    }

    const imageResult = await mammoth.extractRawText({ buffer: fileBuffer });
    const textContent = imageResult.value;

    if (textContent.trim().length === 0) {
      return { success: false, error: "DOCX file contains no extractable text" };
    }

    const imageBuffer = await renderTextToImage(textContent);

    logger.info(
      { inputSize: fileBuffer.length, outputSize: imageBuffer.length },
      "DOCX converted to image via text rendering"
    );

    return {
      success: true,
      buffer: imageBuffer,
      mimeType: "image/png",
      extension: ".png",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage }, "DOCX to image conversion failed");
    return { success: false, error: `DOCX conversion failed: ${errorMessage}` };
  }
}

// ─── Text-to-Image Rendering ─────────────────────────────────────────────────

const CANVAS_WIDTH = 800;
const CANVAS_PADDING = 40;
const FONT_SIZE = 16;
const LINE_HEIGHT = 24;
const MAX_LINES = 60;

async function renderTextToImage(text: string): Promise<Buffer> {
  const { createCanvas } = await import("@napi-rs/canvas");

  const lines = wrapText(text, CANVAS_WIDTH - CANVAS_PADDING * 2);
  const visibleLines = lines.slice(0, MAX_LINES);
  const canvasHeight = CANVAS_PADDING * 2 + visibleLines.length * LINE_HEIGHT;

  const canvas = createCanvas(CANVAS_WIDTH, canvasHeight);
  const context = canvas.getContext("2d");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, CANVAS_WIDTH, canvasHeight);

  context.fillStyle = "#000000";
  context.font = `${FONT_SIZE}px monospace`;

  for (let lineIndex = 0; lineIndex < visibleLines.length; lineIndex++) {
    const yPosition = CANVAS_PADDING + (lineIndex + 1) * LINE_HEIGHT;
    context.fillText(visibleLines[lineIndex], CANVAS_PADDING, yPosition);
  }

  return Buffer.from(canvas.toBuffer("image/png"));
}

function wrapText(text: string, maxWidth: number): string[] {
  const approximateCharWidth = 9.6;
  const maxCharsPerLine = Math.floor(maxWidth / approximateCharWidth);
  const paragraphs = text.split("\n");
  const wrappedLines: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.trim().length === 0) {
      wrappedLines.push("");
      continue;
    }

    let remaining = paragraph;
    while (remaining.length > maxCharsPerLine) {
      let breakPoint = remaining.lastIndexOf(" ", maxCharsPerLine);
      if (breakPoint <= 0) {
        breakPoint = maxCharsPerLine;
      }
      wrappedLines.push(remaining.substring(0, breakPoint));
      remaining = remaining.substring(breakPoint).trimStart();
    }
    wrappedLines.push(remaining);
  }

  return wrappedLines;
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

async function cleanupTemporaryDirectory(directoryPath: string): Promise<void> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(directoryPath);
  for (const entry of entries) {
    await unlink(path.join(directoryPath, entry)).catch(() => {});
  }
  const { rmdir } = await import("node:fs/promises");
  await rmdir(directoryPath).catch(() => {});
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Convert a file to a browser-viewable image format.
 * Returns the converted buffer or an error if conversion fails.
 */
export async function convertToViewableFormat(
  fileBuffer: Buffer,
  filename: string
): Promise<FileConversionResult> {
  if (isHeicFile(filename)) {
    return convertHeicToJpeg(fileBuffer);
  }

  if (isDocFile(filename)) {
    // DOC → PDF → PNG for browser-viewable preview
    const pdfResult = await convertDocToPdf(fileBuffer, filename);
    if (!pdfResult.success) {
      return pdfResult;
    }

    const { convertPdfToImages } = await import("@/lib/pdf-to-image");
    const imageResult = await convertPdfToImages(pdfResult.buffer);

    if (!imageResult.success) {
      return { success: false, error: `DOC→PDF→image failed: ${imageResult.error}` };
    }

    if (imageResult.pages.length === 0) {
      return { success: false, error: "DOC conversion produced no pages" };
    }

    return {
      success: true,
      buffer: imageResult.pages[0].pngBuffer,
      mimeType: "image/png",
      extension: ".png",
    };
  }

  if (isDocxFile(filename)) {
    return convertDocxToImages(fileBuffer);
  }

  return { success: false, error: `No conversion available for: ${filename}` };
}

/**
 * Convert a file to an image buffer suitable for OCR processing.
 * For DOC files, this converts DOC→PDF→images using the existing PDF pipeline.
 * For HEIC, returns JPEG directly.
 * For DOCX, renders text content to an image.
 */
export async function convertForOcr(
  fileBuffer: Buffer,
  filename: string
): Promise<FileConversionResult> {
  if (isHeicFile(filename)) {
    return convertHeicToJpeg(fileBuffer);
  }

  if (isDocFile(filename)) {
    return convertDocToPdf(fileBuffer, filename);
  }

  if (isDocxFile(filename)) {
    return convertDocxToImages(fileBuffer);
  }

  return { success: false, error: `No conversion available for: ${filename}` };
}
