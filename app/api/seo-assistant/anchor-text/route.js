import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import OpenAI from "openai";
import { logTrainingEvent } from "../../../lib/trainingLogger";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function handlePOST(req) {
  try {
    const { fromUrl, toUrl, targetSlug, userId, onboarding = {} } =
      await req.json();

    console.log("📥 Received targetSlug:", targetSlug);

    const readableSlug = targetSlug
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const prompt = `
You are an SEO expert.

Your job is to create a short, natural-sounding anchor text that links TO a page titled: **${readableSlug}**.

Rules:
- Use the phrase above as your only source of context
- Make the anchor readable and no more than 6 words
- Do not mention the source page or use vague phrases like "click here" or "home page"
- Only return the anchor text (no quotes, no markdown, no explanation)
`.trim();

    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Simple rewrite task - GPT-3.5-turbo is sufficient and much cheaper
      messages: [{ role: "user", content: prompt }],
    });

    const anchorText = response.choices[0].message.content.trim();

    await logTrainingEvent({
      userId,
      eventType: "anchor_text_generated",
      businessType: onboarding.businessType,
      businessLocation: onboarding.businessLocation,
      payload: {
        fromUrl,
        toUrl,
        targetSlug,
        anchorText,
        createdAt: new Date().toISOString(),
      },
    });

    return Response.json({ anchorText });
  } catch (err) {
    console.error("❌ Anchor Text API Error:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export const POST = authenticatedRoute(handlePOST, { quota: 'ai' });
