import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const AI_API_KEY = process.env.AI_API_KEY;
const AI_API_BASE_URL = process.env.AI_API_BASE_URL || "https://api.openai.com/v1";
const AI_MODEL_NAME = process.env.AI_MODEL_NAME || "gpt-4o-mini";

const FIXTURE_PATH = resolve(__dirname, "fixtures/sample-receipt.jpg");

describe.skipIf(!AI_API_KEY)("OCR extraction — real AI API", () => {
  it("extracts receipt data matching the expected JSON schema", async () => {
    const fileBuffer = readFileSync(FIXTURE_PATH);
    const base64Content = fileBuffer.toString("base64");
    const dataUri = `data:image/jpeg;base64,${base64Content}`;

    const ocrPrompt = `You are a receipt verification expert. Analyze this receipt and extract the following information:

1. Shop/Store name (the business name on the receipt)
2. Transaction date (format: YYYY-MM-DD)
3. Total amount (number only, without currency symbol)
4. Whether the receipt is clearly readable
5. Your confidence level (0-100)
6. Brief reasoning about your analysis

Respond with JSON in this exact format:
{
  "extractedShopName": "string - shop name from receipt, or null if not found",
  "extractedDate": "YYYY-MM-DD or null if not found",
  "extractedAmount": number or null if not found,
  "receiptReadable": true/false,
  "confidence": 0-100,
  "reasoning": "brief explanation"
}

Respond with raw JSON only.`;

    const messages = [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: ocrPrompt },
          { type: "image_url" as const, image_url: { url: dataUri } },
        ],
      },
    ];

    const response = await fetch(`${AI_API_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL_NAME,
        messages,
        max_tokens: 2000,
        response_format: { type: "json_object" },
      }),
    });

    expect(response.ok).toBe(true);

    const responseBody = await response.json();
    const content = responseBody.choices?.[0]?.message?.content;
    expect(content).toBeDefined();

    const result = JSON.parse(content);

    // Validate schema: extractedShopName
    expect(result).toHaveProperty("extractedShopName");
    if (result.extractedShopName !== null) {
      expect(typeof result.extractedShopName).toBe("string");
    }

    // Validate schema: extractedDate
    expect(result).toHaveProperty("extractedDate");
    if (result.extractedDate !== null) {
      expect(typeof result.extractedDate).toBe("string");
      expect(result.extractedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }

    // Validate schema: extractedAmount
    expect(result).toHaveProperty("extractedAmount");
    if (result.extractedAmount !== null) {
      const amountType = typeof result.extractedAmount;
      expect(amountType === "number" || amountType === "string").toBe(true);
    }

    // Validate schema: receiptReadable
    expect(result).toHaveProperty("receiptReadable");
    expect(typeof result.receiptReadable).toBe("boolean");

    // Validate schema: confidence
    expect(result).toHaveProperty("confidence");
    expect(typeof result.confidence).toBe("number");
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(100);

    // Validate schema: reasoning
    expect(result).toHaveProperty("reasoning");
    expect(typeof result.reasoning).toBe("string");
    expect(result.reasoning.length).toBeGreaterThan(0);
  });
});
