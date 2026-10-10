import { NextResponse } from "next/server";

export async function GET() {
  if (process.env.NODE_ENV === "production") return Response.json({ error: "Not found" }, { status: 404 });
  const envCheck = {
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    OPENAI_API_KEY_LENGTH: process.env.OPENAI_API_KEY?.length || 0,
    NODE_ENV: process.env.NODE_ENV,
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
  };

  return NextResponse.json({
    success: true,
    environment: envCheck,
    message: envCheck.OPENAI_API_KEY 
      ? "OpenAI API key is configured" 
      : "OpenAI API key is missing"
  });
} 