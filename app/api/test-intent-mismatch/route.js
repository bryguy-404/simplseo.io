import { NextResponse } from "next/server";

export async function GET() {
  if (process.env.NODE_ENV === "production") return Response.json({ error: "Not found" }, { status: 404 });
  try {
    // Test the full flow with a known good example
    const testData = {
      keyword: "web design south bend",
      pageUrl: "https://bryandevelops.com/",
      pageContent: "BryanDevelops is a South Bend web designer offering custom website design and SEO services.",
      title: "Expert Web Designer in South Bend | BryanDevelops",
      metaDescription: "Boost your online presence with BryanDevelops, South Bend's premier web design and SEO expert.",
      headings: ["BRYAN WEB SOLUTIONS", "As a South Bend Web Designer, Why Should You Choose Me?"]
    };

    console.log("🧪 Testing intent analysis with sample data");
    
    const analysisResponse = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/intent-analysis`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(testData),
    });

    if (!analysisResponse.ok) {
      throw new Error(`Intent analysis failed: ${analysisResponse.status}`);
    }

    const analysis = await analysisResponse.json();
    
    return NextResponse.json({
      success: true,
      message: "Intent mismatch analysis is working",
      testData,
      analysis,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("❌ Intent mismatch test failed:", error);
    return NextResponse.json({
      success: false,
      error: error.message,
      details: "Intent mismatch functionality is not working properly"
    }, { status: 500 });
  }
} 