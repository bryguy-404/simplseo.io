"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../contexts/AuthContext";
import { isAccessRequestEnabled } from "../lib/accessRequestConfig";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowRight, Loader2, Sun, Moon, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { auth, db } from "../lib/firebaseConfig";
import { doc, getDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const { login, signup, signInWithGoogle, isLoading } = useAuth();
  const router = useRouter();

  // Detect dark mode from document class and localStorage
  useEffect(() => {
    // Load theme from localStorage on mount
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "dark") {
      document.documentElement.classList.add("dark");
      setIsDarkMode(true);
    } else {
      document.documentElement.classList.remove("dark");
      setIsDarkMode(false);
    }

    const checkDarkMode = () => {
      setIsDarkMode(document.documentElement.classList.contains("dark"));
    };
    
    // Watch for changes
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    
    return () => observer.disconnect();
  }, []);

  // Toggle theme function
  const toggleTheme = () => {
    const newDarkMode = !isDarkMode;
    setIsDarkMode(newDarkMode);
    
    if (newDarkMode) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!email || !password) {
      toast.error("Missing Fields", {
        description: "Please fill in both email and password.",
      });
      return;
    }

    try {
      if (isLogin) {
        await login(email, password);
        const uid = auth.currentUser?.uid;
        const docRef = doc(db, "onboarding", uid);
        const docSnap = await getDoc(docRef);

        const hasCompletedOnboarding =
          docSnap.exists() && docSnap.data()?.isComplete;

        if (hasCompletedOnboarding) {
          router.push("/dashboard");
        } else {
          router.push("/onboarding");
        }
      } else {
        // Check if email is approved before allowing signup (only if access request is enabled)
        if (isAccessRequestEnabled()) {
          const approvalResponse = await fetch(`/api/check-approval?email=${encodeURIComponent(email.trim().toLowerCase())}`);
          const approvalData = await approvalResponse.json();
          
          if (!approvalData.approved) {
            toast.error("Access Required", {
              description: "Your email address is not approved. Please request access first or verify your invitation code.",
            });
            router.push("/request-access");
            return;
          }
          
          // Store approved email in localStorage
          localStorage.setItem("approvedEmail", email.trim().toLowerCase());
        }

        await signup(email, password);
        router.push("/onboarding"); // brand new user, go to onboarding
      }
    } catch (error) {
      toast({
        title: "Authentication error",
        description: error.message || "Something went wrong",
        variant: "destructive",
      });
    }
  };

  // Check approval status when component mounts
  useEffect(() => {
    const checkApproval = async () => {
      const storedEmail = localStorage.getItem("approvedEmail");
      if (storedEmail) {
        try {
          const response = await fetch(`/api/check-approval?email=${encodeURIComponent(storedEmail)}`);
          const data = await response.json();
          if (!data.approved) {
            // Approval was revoked - redirect to request page
            localStorage.removeItem("approvedEmail");
            router.push("/request-access");
          }
        } catch (error) {
          console.error("Error checking approval:", error);
        }
      }
    };
    checkApproval();
  }, [router]);

  const handleGoogleLogin = async () => {
    try {
      console.log("🔐 Starting Google login...");
      await signInWithGoogle();
      console.log("✅ Google login successful");

      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error("No authenticated user found");

      const userEmail = auth.currentUser?.email;
      
      // Check if email is approved (for new signups, only if access request is enabled)
      if (!isLogin && userEmail && isAccessRequestEnabled()) {
        const approvalResponse = await fetch(`/api/check-approval?email=${encodeURIComponent(userEmail.trim().toLowerCase())}`);
        const approvalData = await approvalResponse.json();
        
        if (!approvalData.approved) {
          toast.error("Access Required", {
            description: "Your email address is not approved. Please request access first or verify your invitation code.",
          });
          await signOut(auth);
          router.push("/request-access");
          return;
        }
        
        // Store approved email in localStorage
        localStorage.setItem("approvedEmail", userEmail.trim().toLowerCase());
      }

      const docRef = doc(db, "onboarding", uid);
      const docSnap = await getDoc(docRef);

      const hasCompletedOnboarding =
        docSnap.exists() && docSnap.data()?.isComplete;

    // 🛡️ SAFEGUARD: Detect if user is trying to create new account with existing email
    if (!isLogin && hasCompletedOnboarding) {
      // User clicked "Create Account" but account already exists and is active
      toast.error("Account Already Exists", {
        description: "You already have an active account with this Google email. Please log in to your existing account, or use a different Google account to manage a separate GSC property.",
        duration: 10000,
      });
      
      // Sign them out so they can choose what to do
      await signOut(auth);
      setIsLogin(true); // Switch to login mode
      return; // Stop here, don't redirect
    }

    // 🛡️ SAFEGUARD: Detect if user is trying to log in with a non-existent account
    if (isLogin && !hasCompletedOnboarding) {
      // User clicked "Log In" but no account exists
      toast.error("No Account Found", {
        description: "We couldn't find an account with this Google email. Please create an account first.",
        duration: 8000,
      });
      
      // Sign them out so they can create an account
      await signOut(auth);
      setIsLogin(false); // Switch to create account mode
      return; // Stop here, don't redirect
    }

    // Normal flow: redirect based on onboarding status
      if (hasCompletedOnboarding) {
        router.push("/dashboard");
      } else {
        router.push("/onboarding");
      }
    } catch (error) {
      console.error("❌ Google login error:", error);
      toast({
        title: "Google Login Failed",
        description: error.message || "Something went wrong",
        variant: "destructive",
      });
    }
  };

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
        {/* Back to Home Link */}
        <Link 
          href="/home" 
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>
        
        <div className="text-center mb-8">
          <div>
            <img
              src={isDarkMode ? "./dark.png" : "./light.png"}
              alt="SimplSEO.io Logo"
              className="w-full h-auto rounded-md"
            />
          </div>
          <p className="text-muted-foreground mt-2">
            Your personal SEO assistant for all businesses
          </p>
          <p className="text-sm  mt-3">
            For the best experience, we recommend using a desktop or laptop
          </p>
        </div>

        <Card 
          key={isLogin ? "login" : "signup"}
          className={`backdrop-blur-xl bg-background/40 border border-white/10 rounded-2xl shadow-2xl transition-opacity duration-300 ${isTransitioning ? 'opacity-0' : 'opacity-100'}`}
        >
          <CardHeader>
            <CardTitle>
              {isLogin ? "Log In" : "Create Account"}
            </CardTitle>
            <CardDescription>
              {isLogin
                ? "Welcome back! Sign in with your Google account to access your dashboard."
                : "Get started! Create an account with your Google account to begin optimizing your SEO."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="w-full mb-6 flex items-center justify-center gap-2"
              type="button"
              onClick={handleGoogleLogin}
              disabled={isLoading}
            >
              <img
                src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                alt="Google"
                className="h-5 w-5"
              />
              Continue with Google
            </Button>

            {/* Email/Password form - Hidden but logic preserved for future use */}
            <form onSubmit={handleSubmit} className={`space-y-4 ${process.env.NEXT_PUBLIC_SIMPLESEO_TEST_MODE === "1" ? "" : "hidden"}`}>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    {isLogin ? "Log In" : "Create Account"}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </form>

            {/* Toggle between login/signup */}
            <div className="mt-6 text-center">
              <p className="text-sm text-muted-foreground">
                {isLogin
                  ? "Don't have an account?"
                  : "Already have an account?"}
                <button
                  type="button"
                  className="ml-1 text-primary hover:underline font-medium"
                  onClick={() => {
                    setIsTransitioning(true);
                    setTimeout(() => {
                      setIsLogin(!isLogin);
                      setTimeout(() => {
                        setIsTransitioning(false);
                      }, 50);
                    }, 150);
                  }}
                >
                  {isLogin ? "Create one" : "Log in"}
                </button>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Theme Toggle Button - Below Card */}
        <div className="mt-6 flex justify-center">
          <button
            onClick={toggleTheme}
            className="relative inline-flex h-7 w-14 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            style={{
              backgroundColor: isDarkMode ? '#9ca3af' : '#000000'
            }}
            title={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
          >
            {/* Sun Icon (Light Mode) - Always visible */}
            <div className="absolute left-1.5 flex items-center justify-center z-10">
              <Sun className="w-3.5 h-3.5 text-white" />
            </div>
            
            {/* Moon Icon (Dark Mode) - Always visible */}
            <div className="absolute right-1.5 flex items-center justify-center z-10">
              <Moon className="w-3.5 h-3.5 text-white" />
            </div>
            
            {/* Toggle Knob */}
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform duration-300 ease-in-out z-20 ${
                isDarkMode ? 'translate-x-7' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;
