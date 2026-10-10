"use client";

import { authenticatedFetch } from "../lib/authenticatedFetch";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth } from "../contexts/AuthContext";
import { useOnboarding } from "../contexts/OnboardingContext";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebaseConfig";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Globe,
  MapPin,
  Computer,
  CheckCircle,
  FileText,
  HelpCircle,
  ExternalLink,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const businessTypes = [
  "Dentist",
  "Restaurant",
  "Roofer",
  "Plumber",
  "Hair Salon",
  "Retail Store",
  "Law Firm",
  "Real Estate",
  "Fitness",
  "Car Wash",
  "Automotive Services",
  "Oil Change",
  "Auto Repair",
  "Pet Grooming",
  "Cleaning Services",
  "Landscaping",
  "HVAC",
  "Electrician",
  "Contractor",
  "Other",
];

const cmsPlatforms = [
  "WordPress",
  "Wix",
  "Squarespace",
];

// GSC Setup Guide Modal Component
const GSCSetupGuideModal = ({ websiteUrl }) => {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [expandedPlatform, setExpandedPlatform] = useState(null);
  
  const siteUrl = websiteUrl || "https://yourwebsite.com/";
  
  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };
  
  const togglePlatform = (platform) => {
    setExpandedPlatform(expandedPlatform === platform ? null : platform);
  };
  
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-1 text-primary hover:text-primary/80 underline text-sm font-medium transition-colors">
          <HelpCircle className="w-4 h-4" />
          Need help setting up GSC?
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto w-[calc(100%-2rem)] sm:w-full mx-auto rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Computer className="w-5 h-5 text-primary" />
            How to Set Up Google Search Console
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6 mt-4">
          {/* Step 1: Go to GSC */}
          <div className="space-y-2">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">1</span>
              Go to Google Search Console
            </h3>
            <p className="text-muted-foreground ml-2 sm:ml-9">
              Open{" "}
              <a 
                href="https://search.google.com/search-console" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                search.google.com/search-console
                <ExternalLink className="w-3 h-3" />
              </a>
              {" "}and sign in with the same Google account you are using to create an account with SimplSEO.
            </p>
          </div>
          
          {/* Step 2: Add Property */}
          <div className="space-y-3">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">2</span>
              Add a New Property
            </h3>
            <div className="ml-2 sm:ml-9 space-y-3">
              <p className="text-muted-foreground">
                Click <strong>&quot;Add property&quot;</strong> in the top-left dropdown menu. You&apos;ll see two options:
              </p>
              
              {/* Domain vs URL Prefix comparison */}
              <div className="grid md:grid-cols-2 gap-3">
                {/* Domain option */}
                <div className="border border-border rounded-lg p-4 bg-muted/30">
                  <h4 className="font-semibold text-amber-600 dark:text-amber-400 mb-2">🌐 Domain</h4>
                  <p className="text-sm text-muted-foreground mb-2">
                    Tracks all URLs across all subdomains (www, blog, shop, etc.)
                  </p>
                  <ul className="text-xs text-muted-foreground space-y-1">
                    <li>• Requires DNS verification</li>
                    <li>• More comprehensive data</li>
                    <li>• Slightly more technical</li>
                  </ul>
                </div>
                
                {/* URL Prefix option - Recommended */}
                <div className="border-2 border-primary rounded-lg p-4 bg-primary/5 relative">
                  <span className="absolute -top-2 right-2 bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded-full font-medium">
                    Recommended
                  </span>
                  <h4 className="font-semibold text-primary mb-2">🔗 URL Prefix</h4>
                  <p className="text-sm text-muted-foreground mb-2">
                    Tracks only URLs that start with your specified address
                  </p>
                  <ul className="text-xs text-muted-foreground space-y-1">
                    <li>• Easiest to set up</li>
                    <li>• Multiple verification options</li>
                    <li>• Perfect for most websites</li>
                  </ul>
                </div>
              </div>
              
              {/* URL to enter */}
              <div className="bg-muted rounded-lg p-3 border border-border">
                <p className="text-sm font-medium mb-2">Enter your website URL:</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-background px-3 py-2 rounded text-sm border border-border">
                    {siteUrl}
                  </code>
                  <button 
                    onClick={() => copyToClipboard(siteUrl)}
                    className="p-2 hover:bg-background rounded transition-colors"
                    title="Copy URL"
                  >
                    {copiedUrl ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  💡 Make sure to include <code className="bg-background px-1 rounded">https://</code> at the beginning
                </p>
              </div>
            </div>
          </div>
          
          {/* Step 3: Verify Ownership */}
          <div className="space-y-3">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">3</span>
              Verify Ownership
            </h3>
            <div className="ml-2 sm:ml-9 space-y-3">
              <p className="text-muted-foreground">
                After adding your URL, Google will ask you to verify you own the website. The easiest method is <strong>HTML Tag</strong>:
              </p>
              
              {/* HTML Tag Method */}
              <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 rounded-lg p-4">
                <h4 className="font-semibold text-green-700 dark:text-green-400 mb-2 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  HTML Tag (Easiest Method)
                </h4>
                <ol className="text-sm space-y-2 text-green-800 dark:text-green-300">
                  <li>1. Select <strong>&quot;HTML tag&quot;</strong> from the verification options</li>
                  <li>2. Copy the meta tag Google provides (looks like: <code className="bg-green-100 dark:bg-green-900/50 px-1 rounded text-xs">&lt;meta name=&quot;google-site-verification&quot; content=&quot;...&quot; /&gt;</code>)</li>
                  <li>3. Add it to the <code className="bg-green-100 dark:bg-green-900/50 px-1 rounded">&lt;head&gt;</code> section of your website</li>
                  <li>4. Click <strong>&quot;Verify&quot;</strong> in Google Search Console</li>
                </ol>
              </div>
              
              {/* Platform-specific instructions */}
              <div className="space-y-2">
                <p className="font-medium text-sm">Platform-Specific Instructions:</p>
                
                {/* WordPress */}
                <div className="border border-border rounded-lg overflow-hidden">
                  <button 
                    onClick={() => togglePlatform('wordpress')}
                    className="w-full px-4 py-3 flex items-center justify-between bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <span className="font-medium flex items-center gap-2">
                      <span className="text-blue-500">📘</span> WordPress
                    </span>
                    {expandedPlatform === 'wordpress' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {expandedPlatform === 'wordpress' && (
                    <div className="p-4 text-sm space-y-3 bg-background">
                      <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-900">
                        <p className="font-medium text-green-700 dark:text-green-400 flex items-center gap-1">
                          <CheckCircle className="w-4 h-4" />
                          Option A: WPCode Plugin (Recommended)
                        </p>
                        <ol className="list-decimal list-inside space-y-1 text-muted-foreground ml-2 mt-2">
                          <li>Install the free <strong>&quot;WPCode&quot;</strong> plugin from Plugins → Add New</li>
                          <li>Go to <strong>Code Snippets → Header & Footer</strong></li>
                          <li>Paste the full meta tag in the <strong>&quot;Header&quot;</strong> section</li>
                          <li>Click <strong>&quot;Save Changes&quot;</strong></li>
                        </ol>
                        <p className="text-xs text-green-600 dark:text-green-400 mt-2">
                          💡 WPCode is beginner-friendly and won&apos;t break your site!
                        </p>
                      </div>
                      
                      <p className="font-medium text-blue-600 dark:text-blue-400">Option B: Using Yoast SEO</p>
                      <ol className="list-decimal list-inside space-y-1 text-muted-foreground ml-2">
                        <li>Go to <strong>Yoast SEO → Settings → Site connections</strong></li>
                        <li>Find the <strong>&quot;Google verification code&quot;</strong> field</li>
                        <li>Paste only the <code className="bg-muted px-1 rounded">content=&quot;...&quot;</code> value (the code between quotes)</li>
                        <li>Save changes</li>
                      </ol>
                      
                      {/* <p className="font-medium text-blue-600 dark:text-blue-400 mt-3">Option C: Manual (Theme Header)</p>
                      <ol className="list-decimal list-inside space-y-1 text-muted-foreground ml-2">
                        <li>Go to <strong>Appearance → Theme Editor → header.php</strong></li>
                        <li>Paste the full meta tag inside the <code className="bg-muted px-1 rounded">&lt;head&gt;</code> section</li>
                        <li>Save the file</li>
                      </ol>
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 ml-2">
                        ⚠️ Be careful editing theme files — a mistake can break your site
                      </p> */}
                    </div>
                  )}
                </div>
                
                {/* Wix */}
                <div className="border border-border rounded-lg overflow-hidden">
                  <button 
                    onClick={() => togglePlatform('wix')}
                    className="w-full px-4 py-3 flex items-center justify-between bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <span className="font-medium flex items-center gap-2">
                      <span className="text-yellow-500">🟡</span> Wix
                    </span>
                    {expandedPlatform === 'wix' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {expandedPlatform === 'wix' && (
                    <div className="p-4 text-sm space-y-2 bg-background">
                      <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                        <li>Go to your <strong>Wix Dashboard</strong></li>
                        <li>Click <strong>Settings</strong> in the left menu</li>
                        <li>Scroll down and click <strong>&quot;Custom Code&quot;</strong> (under Advanced)</li>
                        <li>Click <strong>&quot;+ Add Custom Code&quot;</strong></li>
                        <li>Paste the full meta tag</li>
                        <li>Name it <strong>&quot;Google Search Console Verification&quot;</strong></li>
                        <li>Set placement to <strong>&quot;Head&quot;</strong></li>
                        <li>Set pages to <strong>&quot;All pages&quot;</strong></li>
                        <li>Click <strong>&quot;Apply&quot;</strong></li>
                      </ol>
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                        ⚠️ Note: You need a Wix Premium plan to add custom code
                      </p>
                    </div>
                  )}
                </div>
                
                {/* Squarespace */}
                <div className="border border-border rounded-lg overflow-hidden">
                  <button 
                    onClick={() => togglePlatform('squarespace')}
                    className="w-full px-4 py-3 flex items-center justify-between bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <span className="font-medium flex items-center gap-2">
                      <span className="text-gray-700 dark:text-gray-300">⬛</span> Squarespace
                    </span>
                    {expandedPlatform === 'squarespace' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {expandedPlatform === 'squarespace' && (
                    <div className="p-4 text-sm space-y-3 bg-background">
                      <p className="font-medium text-foreground">Option A: HTML Tag (Code Injection)</p>
                      <ol className="list-decimal list-inside space-y-1 text-muted-foreground ml-2">
                        <li>Go to <strong>Settings → Developer Tools → Code Injection</strong></li>
                        <li>Paste the full meta tag in the <strong>&quot;Header&quot;</strong> section</li>
                        <li>Click <strong>&quot;Save&quot;</strong></li>
                        <li>Return to GSC and click <strong>&quot;Verify&quot;</strong></li>
                      </ol>
                      
                      <div className="border-t border-border pt-3 mt-3">
                        <p className="font-medium text-green-600 dark:text-green-400 flex items-center gap-1">
                          <CheckCircle className="w-4 h-4" />
                          Option B: Built-in Integration (Easiest!)
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 mb-2">
                          Squarespace can verify your site automatically — no meta tag needed:
                        </p>
                        <ol className="list-decimal list-inside space-y-1 text-muted-foreground ml-2">
                          <li>Go to <strong>Settings → Connected Accounts</strong></li>
                          <li>Click <strong>&quot;Connect Account&quot;</strong></li>
                          <li>Select <strong>&quot;Google Search Console&quot;</strong></li>
                          <li>Sign in with your Google account</li>
                          <li>Authorize access — Squarespace verifies ownership for you!</li>
                        </ol>
                        <p className="text-xs text-muted-foreground mt-2 p-2 bg-green-50 dark:bg-green-950/30 rounded border border-green-200 dark:border-green-900">
                          💡 This method skips the HTML tag entirely — Squarespace handles verification through its direct connection with Google!
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          
          {/* Step 4: Come Back */}
          <div className="space-y-2">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">4</span>
              Return Here & Connect
            </h3>
            <p className="text-muted-foreground ml-2 sm:ml-9">
              Once verified in Google Search Console, come back here, toggle <strong>&quot;Yes&quot;</strong>, and now you will see your website URL appear under <strong>&quot;Select GSC Property&quot;</strong> and select it to connect your Google account to continue.
            </p>
          </div>
          
          {/* Pro Tips */}
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-4">
            <h4 className="font-semibold text-amber-700 dark:text-amber-400 mb-2">💡 Pro Tips</h4>
            <ul className="text-sm space-y-1 text-amber-800 dark:text-amber-300">
              <li>• It can take a few minutes for Google to verify your site</li>
              <li>• Make sure your website is live and accessible</li>
              <li>• If verification fails, wait a few minutes and try again</li>
              <li>• Data in GSC may take 2-3 days to start appearing after verification</li>
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const OnboardingWizard = () => {
  const { data, updateData } = useOnboarding();
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [gscProperties, setGscProperties] = useState([]);
  const [isLoadingProperties, setIsLoadingProperties] = useState(false);
  const [googleAccessToken, setGoogleAccessToken] = useState(null);
  const [googleRefreshToken, setGoogleRefreshToken] = useState(null);
  const [oauthError, setOauthError] = useState(null);
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && user && data.isComplete) {
      router.push("/dashboard");
    }
  }, [user, isLoading, data.isComplete, router]);

  const totalSteps = 5;

  const nextStep = () => {
    if (currentStep < totalSteps && isStepValid()) {
      setCurrentStep(currentStep + 1);
    }
  };

  const isStepValid = () => {
    switch (currentStep) {
      case 1:
        // If "Other" is selected, customBusinessType is required
        if (data.businessType === "Other") {
          return data.name && data.businessName && data.businessType && data.customBusinessType;
        }
        return data.name && data.businessName && data.businessType;
      case 2:
        return data.websiteUrl && data.cmsPlatform;
      case 3:
        return data.businessLocation;
      case 4:
        // GSC is mandatory - user must toggle "Yes" AND connect/select a property
        return data.hasGSC && data.gscProperty;
      case 5:
        // Privacy policy must be accepted
        return data.privacyPolicyAccepted === true;
      default:
        return false;
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const submitOnboarding = async () => {
    setIsSubmitting(true);
    try {
      await updateData({ isComplete: true, postOnboardingStep: 'pages', pagesStepCompleted: false });
      router.push('/dashboard');
    } catch (error) {
      window.alert('Your setup could not be saved. Please try again.');
    } finally { setIsSubmitting(false); }
  };

  const getProgressPercent = () => {
    return (currentStep / totalSteps) * 100;
  };

  // Handle Google OAuth
  const handleGoogleAuth = () => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "956212275866-7dtgdq7b38b156riehghuvh8b8469ktg.apps.googleusercontent.com";
    const redirectUri = `${window.location.origin}/api/auth/google/callback`;
    const scope = 'https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/userinfo.email';
    
    // Debug logging
    console.log('Google OAuth Debug:', {
      clientId,
      redirectUri,
      scope,
      origin: window.location.origin
    });
    
    if (!clientId) {
      alert('Google Client ID not found. Please check your environment variables.');
      return;
    }
    
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${clientId}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `scope=${encodeURIComponent(scope)}&` +
      `response_type=code&` +
      `access_type=offline&` +
      `prompt=consent`;
    
    console.log('Auth URL:', authUrl);
    window.location.href = authUrl;
  };

  // Fetch GSC properties
  const fetchGscProperties = useCallback(async (accessToken) => {
    setIsLoadingProperties(true);
    try {
      const response = await fetch(`/api/gsc/properties?accessToken=${accessToken}`);
      const result = await response.json();
      
      if (result.success) {
        setGscProperties(result.properties);
      } else {
        console.error("Failed to fetch GSC properties:", result.error);
      }
    } catch (error) {
      console.error("Error fetching GSC properties:", error);
    } finally {
      setIsLoadingProperties(false);
    }
  }, []);

  // Check for Google OAuth callback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const accessToken = urlParams.get('access_token');
    const refreshToken = urlParams.get('refresh_token');
    const email = urlParams.get('email');
    const step = urlParams.get('step');
    const error = urlParams.get('error');
    
    console.log("🔍 OAuth callback tokens:", {
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refreshToken,
      email: email,
      step: step,
      error: error
    });
    
    // Handle error case
    if (error === 'google_auth_failed') {
      console.error("❌ Google OAuth failed");
      setOauthError("Failed to connect Google account. Please try again.");
      // Set step to 4 if provided, otherwise stay on current step
      if (step) {
        setCurrentStep(parseInt(step));
      }
      // Clean up URL but keep error for user feedback
      const newUrl = `${window.location.pathname}${step ? `?step=${step}` : ''}`;
      window.history.replaceState({}, document.title, newUrl);
      return;
    }
    
    // Clear error if OAuth succeeded
    if (accessToken && email) {
      setOauthError(null);
    }
    
    if (accessToken && email) {
      setGoogleAccessToken(accessToken);
      if (refreshToken) {
        setGoogleRefreshToken(refreshToken);
      }
      updateData({ googleEmail: email });
      fetchGscProperties(accessToken);
      
      // Set the step if provided (for OAuth callback)
      if (step) {
        setCurrentStep(parseInt(step));
      }
      
      // Clean up URL
      const newUrl = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    }
  }, [updateData, fetchGscProperties]);

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Animated Background Orbs - Full Width, Fixed to Viewport */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-20 left-10 w-96 h-96 bg-teal-500/20 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute top-40 right-20 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl animate-pulse delay-1000"></div>
        <div className="absolute bottom-20 left-1/3 w-72 h-72 bg-purple-500/20 rounded-full blur-3xl animate-pulse delay-2000"></div>
        <div className="absolute bottom-40 right-1/4 w-96 h-96 bg-pink-500/20 rounded-full blur-3xl animate-pulse delay-3000"></div>
      </div>

      {/* Main Content */}
      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold">Set Up Your SEO Coach</h1>
          <p className="text-muted-foreground mt-2">
            Let&apos;s get started with your onboarding process.
          </p>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-muted rounded-full h-2 mb-8">
          <div
            className="bg-primary h-2 rounded-full transition-all duration-300 ease-in-out"
            style={{ width: `${getProgressPercent()}%` }}
          ></div>
        </div>

        <Card className="backdrop-blur-xl bg-background/40 border border-white/10 rounded-2xl shadow-2xl">
          <CardContent className="pt-6">
            {currentStep === 1 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <Building2 className="text-primary" />
                  <h2 className="text-xl font-semibold">
                    Business Information
                  </h2>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Your Name <span className="text-red-500">*</span></Label>
                  <Input
                    id="name"
                    placeholder="e.g. Bryan Arambula"
                    value={data.name || ""}
                    onChange={(e) => updateData({ name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="businessName">Business Name <span className="text-red-500">*</span></Label>
                  <Input
                    id="businessName"
                    placeholder="Acme Inc."
                    value={data.businessName}
                    onChange={(e) =>
                      updateData({ businessName: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="businessType">Business Type <span className="text-red-500">*</span></Label>
                  <Select
                    value={data.businessType}
                    onValueChange={(value) =>
                      updateData({ businessType: value })
                    }
                  >
                    <SelectTrigger id="businessType">
                      <SelectValue placeholder="Select business type" />
                    </SelectTrigger>
                    <SelectContent>
                      {businessTypes.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                {/* Custom business type input when "Other" is selected */}
                {data.businessType === "Other" && (
                  <div className="space-y-2">
                    <Label htmlFor="customBusinessType">Please specify your business type <span className="text-red-500">*</span></Label>
                    <Input
                      id="customBusinessType"
                      placeholder="e.g. Car Wash, Tour Guide, Landscaping"
                      value={data.customBusinessType || ""}
                      onChange={(e) =>
                        updateData({ customBusinessType: e.target.value })
                      }
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      This helps us provide better SEO recommendations for your specific business.
                    </p>
                  </div>
                )}
                <p className="text-sm text-muted-foreground mt-4">
                  <span className="text-red-500">*</span> All fields are required to continue
                </p>
              </div>
            )}

            {currentStep === 2 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <Globe className="text-primary" />
                  <h2 className="text-xl font-semibold">Website Information</h2>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="websiteUrl">Website URL <span className="text-red-500">*</span></Label>
                  <Input
                    id="websiteUrl"
                    placeholder="https://example.com"
                    value={data.websiteUrl}
                    onChange={(e) => updateData({ websiteUrl: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cmsPlatform">Website Platform <span className="text-red-500">*</span></Label>
                  <Select
                    value={data.cmsPlatform}
                    onValueChange={(value) =>
                      updateData({ cmsPlatform: value })
                    }
                  >
                    <SelectTrigger id="cmsPlatform">
                      <SelectValue placeholder="Select platform" />
                    </SelectTrigger>
                    <SelectContent>
                      {cmsPlatforms.map((platform) => (
                        <SelectItem key={platform} value={platform}>
                          {platform}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-sm text-muted-foreground mt-4">
                  <span className="text-red-500">*</span> All fields are required to continue
                </p>
              </div>
            )}

            {currentStep === 3 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <MapPin className="text-primary" />
                  <h2 className="text-xl font-semibold">
                    Location Information
                  </h2>
                </div>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="businessLocation">
                      Business Location <span className="text-red-500">*</span>
                    </Label>
                    {data.servesMultipleCities ? (
                      <>
                        <p className="text-sm text-muted-foreground mt-2">
                          Enter the <span className="font-bold">State</span> your business serves. <br></br> This will help optimize your local SEO keywords for all your locations.
                        </p>
                        <Input
                          id="businessLocation"
                          placeholder="e.g. Indiana"
                          value={data.businessLocation}
                          onChange={(e) =>
                            updateData({ businessLocation: e.target.value })
                          }
                          required
                        />
                      </>
                    ) : (
                      <>
                        <p className="text-sm text-muted-foreground mt-2">
                          Enter the <span className="font-bold">City and State</span> your business serves. <br></br> This will help optimize your local SEO keywords
                        </p>
                        <Input
                          id="businessLocation"
                          placeholder="e.g. South Bend, IN"
                          value={data.businessLocation}
                          onChange={(e) =>
                            updateData({ businessLocation: e.target.value })
                          }
                          required
                        />
                      </>
                    )}
                  </div>
                  
                  <div className="flex items-center justify-between p-4 border rounded-lg bg-card">
                    <div className="space-y-0.5">
                      <Label htmlFor="servesMultipleCities" className="text-base font-medium">
                        Do you serve multiple cities?
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Toggle this if your business has locations in multiple cities, if not just enter City and State above.
                      </p>
                    </div>
                    <Switch
                      id="servesMultipleCities"
                      checked={data.servesMultipleCities || false}
                      onCheckedChange={(checked) => {
                        updateData({ 
                          servesMultipleCities: checked,
                          businessLocation: "" // Clear location when toggling
                        });
                      }}
                    />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-4">
                  <span className="text-red-500">*</span> All fields are required to continue
                </p>
              </div>
            )}

            {currentStep === 4 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <Computer className="text-primary" />
                  <h2 className="text-xl font-semibold">Analytics Setup</h2>
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="hasGSC">
                      Do you have Google Search Console set up? <br></br> If &quot;YES&quot; please toggle. If &quot;NO&quot; follow steps below.
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      <strong>Important:</strong> Google Search Console is required to track your search performance and provide SEO insights
                    </p>
                  </div>
                  <Switch
                    id="hasGSC"
                    checked={data.hasGSC}
                    onCheckedChange={(checked) =>
                      updateData({ hasGSC: checked })
                    }
                  />
                </div>

                {!data.hasGSC && (
                  <div className="bg-muted p-3 rounded-md mt-4">
                    <div className="space-y-3">
                      <p className="text-sm font-medium">
                        <strong>Required Setup:</strong> You&apos;ll need to set up Google Search Console first:
                      </p>
                      <ol className="text-sm text-muted-foreground space-y-2 ml-4">
                        <li>1. Go to <a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer" className="text-primary underline">Google Search Console</a></li>
                        <li>2. Add your property: <code className="bg-background px-1 rounded">{data.websiteUrl || "your-website.com"}</code></li>
                        <li>3. Verify ownership (DNS record or HTML file)</li>
                        <li>4. Come back and connect your account</li>
                      </ol>
                      <div className="pt-3 border-t border-border/50 mt-3">
                        <GSCSetupGuideModal websiteUrl={data.websiteUrl} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        <strong>Note:</strong> Google Search Console is required to continue. Please complete the setup steps above, then return to toggle &quot;Yes&quot; and connect your account.
                      </p>
                    </div>
                  </div>
                )}

                {data.hasGSC && (
                  <div className="space-y-4 mt-4">
                    {/* Error message display */}
                    {oauthError && (
                      <div className="bg-destructive/10 border border-destructive/50 text-destructive px-4 py-3 rounded-md">
                        <p className="text-sm font-medium">{oauthError}</p>
                        <p className="text-xs mt-1 opacity-90">Please check that the redirect URI matches your Google Cloud Console settings.</p>
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label htmlFor="gscProperty">Select GSC Property</Label>
                      <Select
                        value={data.gscProperty || ""}
                        onValueChange={async (value) => {
                          if (value === "connect") {
                            handleGoogleAuth();
                          } else {
                            console.log("🎯 GSC Property selected:", value);
                            updateData({ gscProperty: value });
                            console.log("✅ GSC Property saved to context");
                            
                            // Store the Google tokens in Firestore for the selected property
                            if (googleAccessToken && user?.id) {
                              try {
                                console.log("💾 Storing Google tokens for property:", value);
                                const response = await authenticatedFetch('/api/gsc/exchange-code', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    accessToken: googleAccessToken,
                                    refreshToken: googleRefreshToken,
                                    property: value,
                                    userId: user.id
                                  })
                                });
                                
                                if (response.ok) {
                                  console.log("✅ Google tokens stored successfully");
                                } else {
                                  console.error("❌ Failed to store Google tokens");
                                }
                              } catch (error) {
                                console.error("❌ Error storing Google tokens:", error);
                              }
                            }
                          }
                        }}
                      >
                        <SelectTrigger id="gscProperty">
                          <SelectValue placeholder={
                            googleAccessToken 
                              ? (isLoadingProperties ? "Loading properties..." : "Select a property")
                              : "Connect your Google account to see properties"
                          } />
                        </SelectTrigger>
                        <SelectContent>
                          {!googleAccessToken ? (
                            <SelectItem value="connect">
                              <div className="flex items-center gap-2">
                                <span>🔗 Connect Google Account</span>
                              </div>
                            </SelectItem>
                          ) : (
                            <>
                              {isLoadingProperties ? (
                                <SelectItem value="loading" disabled>
                                  <div className="flex items-center gap-2">
                                    <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin"></div>
                                    <span>Loading properties...</span>
                                  </div>
                                </SelectItem>
                              ) : gscProperties.length > 0 ? (
                                gscProperties.map((property) => (
                                  <SelectItem key={property.siteUrl} value={property.siteUrl}>
                                    <div className="flex items-center gap-2">
                                      <span>{property.siteUrl}</span>
                                      {property.verified && (
                                        <span className="text-green-500 text-xs">✓</span>
                                      )}
                                    </div>
                                  </SelectItem>
                                ))
                              ) : (
                                <SelectItem value="no-properties" disabled>
                                  <div className="flex items-center gap-2">
                                    <span>No GSC properties found</span>
                                  </div>
                                </SelectItem>
                              )}
                            </>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      This property will be used for SEO tracking and insights.
                    </p>
                    {googleAccessToken && gscProperties.length === 0 && !isLoadingProperties && (
                      <p className="text-sm text-amber-600">
                        No verified GSC properties found. Make sure you have verified ownership of your website in Google Search Console.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {currentStep === 5 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <FileText className="text-primary" />
                  <h2 className="text-xl font-semibold">Privacy Policy & Terms</h2>
                </div>
                
                {/* Privacy Policy Summary */}
                <div className="border rounded-lg p-4 max-h-[350px] overflow-y-auto bg-muted/50">
                  <div className="space-y-3 text-sm">
                    <h3 className="font-semibold text-base">Your Data, Your Control</h3>
                    
                    {/* Reassurance statement */}
                    <p className="text-foreground/80 leading-relaxed">
                      We only use your website&apos;s data to give you accurate SEO insights. You are always in control.
                    </p>
                    

                    
                    {/* 1. Privacy & Security (trust first) */}
                    <p className="font-medium mt-3">Privacy & Security:</p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>Your data is encrypted in transit and at rest</li>
                      {/* <li>We do NOT sell your data to third parties</li> */}
                      <li>You can delete your account and data at any time</li>
                      {/* <li>We do not track you across websites, apps, or devices</li> */}
                      <li>We only analyze data you choose to connect (like Google Search Console)</li>
                    </ul>
                    
                    {/* 2. What We Use (light framing) */}
                    <p className="font-medium mt-3">What We Collect to get feedback:</p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>Email address for your account</li>
                      <li>Business name, website, and location you provided during onboarding</li>
                    </ul>
                    
                    {/* 3. Google Search Console (clear reassurance) */}
                    <p className="font-medium mt-3">Google Search Console:</p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>Keywords, pages, impressions, clicks, and rankings</li>
                      <li>Used to provide personalized SEO recommendations</li>
                      <li>Read-only access — we cannot modify your GSC data</li>
                    </ul>

                    {/* AI Recommendations Disclaimer */}
                    <p className="font-medium mt-4">AI Recommendations & Website Changes:</p>
                    <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                      <li>
                        <span className="font-bold">We strongly recommend backing up your website before applying any changes.</span>
                      </li>
                      <li>
                        SimplSEO provides AI-generated SEO recommendations as guidance only and does not
                        guarantee specific results.
                      </li>
                      <li>
                        You are responsible for deciding whether to implement any recommendation and for
                        making changes to your website.
                      </li>

                      <li>
                        SimplSEO is not responsible for website errors, downtime, data loss, ranking
                        changes, or other issues resulting from changes you choose to make.
                      </li>
                    </ul>
                    
                    {/* 4. AI Assistance (clarified, non-threatening) */}
                    <p className="font-medium mt-3">AI Assistance (How It Helps You):</p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>Your data helps personalize SEO recommendations for your account</li>
                      <li>Some requests are processed securely by OpenAI to generate AI responses</li>
                      <li>We do not use your private business data to train public AI models</li>
                      <li>Training data is anonymized (no names, no full conversations)</li>
                    </ul>

                   {/* TL;DR Box */}
                   <div className="p-3 bg-primary/10 rounded-md border border-primary/20">
                      <p className="font-semibold text-foreground text-xs uppercase tracking-wide mb-2">TL;DR</p>
                      <ul className="list-disc list-inside space-y-1 text-foreground/90">
                        <li>We only use your data to help give you the best results</li>
                        <li>Read-only access to Google Search Console</li>
                        {/* <li>We never sell your data</li> */}
                        <li>You&apos;re free to delete everything anytime</li>
                      </ul>
                    </div>
                    
                    {/* 5. Consent statement (softened) */}
                    <div className="mt-4 p-3 bg-muted rounded-md border border-border">
                      <p className="text-foreground/90">
                        By continuing, you agree to our Privacy Policy so we can provide SEO insights tailored to your business. You can delete your account and data at any time.
                      </p>
                    </div>
                  </div>
                </div>
                
                {/* Checkbox */}
                <div className="flex items-start space-x-2 pt-2 border-t pt-4">
                  <Checkbox
                    id="privacyPolicy"
                    checked={data.privacyPolicyAccepted || false}
                    onCheckedChange={(checked) => 
                      updateData({ privacyPolicyAccepted: checked === true })
                    }
                  />
                  <label 
                    htmlFor="privacyPolicy" 
                    className="text-sm cursor-pointer leading-5"
                  >
                    <span className="font-medium">I have read, understood, and agree to the </span>
                    <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Privacy Policy</a>
                    <span className="font-medium"> and consent to the collection and processing of my data as described.</span>
                  </label>
                </div>
              </div>
            )}
          </CardContent>

          <CardFooter className="flex flex-col gap-3 pt-2">
            <div className="flex justify-between w-full">
            {currentStep > 1 ? (
              <Button
                variant="outline"
                onClick={prevStep}
                disabled={isSubmitting}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={async () => {
                  await signOut(auth);
                  router.push("/auth");
                }}
                disabled={isSubmitting}
                className="text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Login
              </Button>
            )}

            {currentStep < totalSteps ? (
                <Button onClick={nextStep} disabled={!isStepValid()}>
                  Next
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
            ) : (
              <Button onClick={submitOnboarding} disabled={isSubmitting || !isStepValid()}>
                {isSubmitting ? (
                  <span className="flex items-center">
                    <svg
                      className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    Processing
                  </span>
                ) : (
                  <>
                    Continue to Dashboard
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
              )}
            </div>
            
            {!isStepValid() && (
              <p className="text-xs text-muted-foreground text-center w-full">
                {currentStep === 4 
                  ? "Please connect your Google Search Console account to continue"
                  : currentStep === 5
                  ? "Please read and accept the Privacy Policy to continue"
                  : "Please fill in all required fields"}
              </p>
            )}
          </CardFooter>
        </Card>
        </div>
      </div>
    </div>
  );
};

export default OnboardingWizard;
