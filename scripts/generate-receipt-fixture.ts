/**
 * Generates a fake receipt image for AI integration testing.
 * Output: tests/ai-integration/fixtures/sample-receipt.jpg
 *
 * Run with: npx tsx scripts/generate-receipt-fixture.ts
 */

import { createCanvas } from "@napi-rs/canvas";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const RECEIPT_WIDTH = 400;
const RECEIPT_HEIGHT = 600;
const BACKGROUND_COLOR = "#FFFFFF";
const TEXT_COLOR = "#000000";
const LIGHT_TEXT_COLOR = "#555555";

const FONT_SIZE_LARGE = 24;
const FONT_SIZE_MEDIUM = 16;
const FONT_SIZE_SMALL = 14;

function generateReceiptImage(): Buffer {
  const canvas = createCanvas(RECEIPT_WIDTH, RECEIPT_HEIGHT);
  const context = canvas.getContext("2d");

  // White background
  context.fillStyle = BACKGROUND_COLOR;
  context.fillRect(0, 0, RECEIPT_WIDTH, RECEIPT_HEIGHT);

  // Draw text content
  context.fillStyle = TEXT_COLOR;
  context.textAlign = "center";

  let yPosition = 50;

  // Shop name (large, bold)
  context.font = `bold ${FONT_SIZE_LARGE}px Arial`;
  context.fillText("Albert Heijn", RECEIPT_WIDTH / 2, yPosition);
  yPosition += 30;

  // Store address
  context.font = `${FONT_SIZE_SMALL}px Arial`;
  context.fillStyle = LIGHT_TEXT_COLOR;
  context.fillText("Kalverstraat 92", RECEIPT_WIDTH / 2, yPosition);
  yPosition += 20;
  context.fillText("1012 PH Amsterdam", RECEIPT_WIDTH / 2, yPosition);
  yPosition += 20;
  context.fillText("Tel: 020-555-0123", RECEIPT_WIDTH / 2, yPosition);
  yPosition += 40;

  // Separator line
  context.strokeStyle = TEXT_COLOR;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(30, yPosition);
  context.lineTo(RECEIPT_WIDTH - 30, yPosition);
  context.stroke();
  yPosition += 25;

  // Date and time
  context.fillStyle = TEXT_COLOR;
  context.font = `${FONT_SIZE_MEDIUM}px Arial`;
  context.textAlign = "left";
  context.fillText("Datum: 15-01-2024", 30, yPosition);
  context.textAlign = "right";
  context.fillText("14:32", RECEIPT_WIDTH - 30, yPosition);
  yPosition += 30;

  // Separator
  context.textAlign = "left";
  context.font = `${FONT_SIZE_SMALL}px Arial`;
  context.fillText("--------------------------------", 30, yPosition);
  yPosition += 25;

  // Line items
  const lineItems = [
    { name: "AH Halfvolle melk 1L", price: "1.39" },
    { name: "AH Brood volkoren", price: "2.49" },
    { name: "AH Kaas jong belegen", price: "4.99" },
    { name: "Douwe Egberts koffie", price: "7.49" },
    { name: "AH Appels Elstar 1kg", price: "2.99" },
    { name: "AH Boter ongezouten", price: "2.89" },
    { name: "AH Eieren vrije uitloop 10st", price: "3.29" },
    { name: "AH Tomaten 500g", price: "2.32" },
  ];

  context.font = `${FONT_SIZE_SMALL}px Arial`;

  for (const item of lineItems) {
    context.textAlign = "left";
    context.fillText(item.name, 30, yPosition);
    context.textAlign = "right";
    context.fillText(`€ ${item.price}`, RECEIPT_WIDTH - 30, yPosition);
    yPosition += 22;
  }

  yPosition += 10;

  // Separator
  context.textAlign = "left";
  context.fillText("--------------------------------", 30, yPosition);
  yPosition += 25;

  // Total
  context.font = `bold ${FONT_SIZE_MEDIUM}px Arial`;
  context.textAlign = "left";
  context.fillText("TOTAAL", 30, yPosition);
  context.textAlign = "right";
  context.fillText("€ 27.85", RECEIPT_WIDTH - 30, yPosition);
  yPosition += 30;

  // Payment method
  context.font = `${FONT_SIZE_SMALL}px Arial`;
  context.textAlign = "left";
  context.fillText("Betaald: PIN", 30, yPosition);
  yPosition += 40;

  // Footer separator
  context.strokeStyle = TEXT_COLOR;
  context.beginPath();
  context.moveTo(30, yPosition);
  context.lineTo(RECEIPT_WIDTH - 30, yPosition);
  context.stroke();
  yPosition += 25;

  // Footer
  context.fillStyle = LIGHT_TEXT_COLOR;
  context.textAlign = "center";
  context.font = `${FONT_SIZE_SMALL}px Arial`;
  context.fillText("Bedankt voor uw bezoek!", RECEIPT_WIDTH / 2, yPosition);
  yPosition += 20;
  context.fillText("BTW nr: NL123456789B01", RECEIPT_WIDTH / 2, yPosition);

  // Encode as JPEG
  const jpegBuffer = canvas.toBuffer("image/jpeg");
  return jpegBuffer;
}

function main(): void {
  const fixturesDirectory = join(
    __dirname,
    "..",
    "tests",
    "ai-integration",
    "fixtures"
  );

  mkdirSync(fixturesDirectory, { recursive: true });

  const outputPath = join(fixturesDirectory, "sample-receipt.jpg");
  const imageBuffer = generateReceiptImage();

  writeFileSync(outputPath, imageBuffer);

  console.log(`Receipt fixture generated: ${outputPath}`);
  console.log(`File size: ${imageBuffer.length} bytes`);
}

main();
