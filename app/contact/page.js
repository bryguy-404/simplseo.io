"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useOnboarding } from "../contexts/OnboardingContext";
import MainLayout from "../components/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Mail, Send, MessageSquare, HelpCircle, Bug, Lightbulb, MapPin, Phone } from "lucide-react";
import { toast } from "sonner";
import { authenticatedFetch } from "../lib/authenticatedFetch";

export default function ContactPage() {
  const { user } = useAuth();
  const { data: onboardingData } = useOnboarding();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: user?.displayName || onboardingData?.name || "",
    email: user?.email || "",
    subject: "",
    message: "",
  });

  // Update name field when onboarding data loads (only if field is empty)
  useEffect(() => {
    if (onboardingData?.name && !formData.name) {
      setFormData((prev) => ({
        ...prev,
        name: onboardingData.name,
      }));
    }
  }, [onboardingData?.name, formData.name]);

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validation
    if (!formData.name.trim()) {
      toast.error("Please enter your name");
      return;
    }
    if (!formData.email.trim()) {
      toast.error("Please enter your email");
      return;
    }
    if (!formData.email.includes("@")) {
      toast.error("Please enter a valid email address");
      return;
    }
    if (!formData.subject) {
      toast.error("Please select a subject");
      return;
    }
    if (!formData.message.trim()) {
      toast.error("Please enter your message");
      return;
    }
    if (formData.message.trim().length < 10) {
      toast.error("Please enter at least 10 characters in your message");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await (user ? authenticatedFetch : fetch)("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...formData,
          userId: user?.id || null,
          userEmail: user?.email || null,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to send message");
      }

      toast.success("Message sent successfully!", {
        description: "We'll get back to you as soon as possible.",
      });

      // Reset form
      setFormData({
        name: user?.displayName || onboardingData?.name || "",
        email: user?.email || "",
        subject: "",
        message: "",
      });
    } catch (error) {
      console.error("Error submitting contact form:", error);
      toast.error("Failed to send message", {
        description: "Please try again in a moment.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getSubjectIcon = (subject) => {
    switch (subject) {
      case "question":
        return <HelpCircle className="w-4 h-4" />;
      case "feedback":
        return <MessageSquare className="w-4 h-4" />;
      case "bug":
        return <Bug className="w-4 h-4" />;
      case "feature":
        return <Lightbulb className="w-4 h-4" />;
      default:
        return <Mail className="w-4 h-4" />;
    }
  };

  return (
    <MainLayout>
      <div className="min-h-screen bg-background relative overflow-hidden">
        {/* Animated Background Orbs - Full Width, Fixed to Viewport */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
          <div className="absolute top-20 left-10 w-96 h-96 bg-teal-500/20 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute top-40 right-20 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl animate-pulse delay-1000"></div>
          <div className="absolute bottom-20 left-1/3 w-72 h-72 bg-purple-500/20 rounded-full blur-3xl animate-pulse delay-2000"></div>
          <div className="absolute bottom-40 right-1/4 w-96 h-96 bg-pink-500/20 rounded-full blur-3xl animate-pulse delay-3000"></div>
        </div>

        {/* Header */}
        <div className="relative z-10 px-6 py-12 text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-3">
            Contact Us
          </h1>
          <p className="text-lg text-muted-foreground">
            Any questions? Just write us a message!
          </p>
        </div>

        {/* Main Content - Glassmorphism Card */}
        <div className="relative z-10 px-6 pb-12 max-w-6xl mx-auto">
          <div className="backdrop-blur-xl bg-background/40 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
              {/* Left Section - Help Us Improve */}
              <div className="bg-gradient-to-br from-green-500/10 to-blue-500/10 p-8 lg:p-12 border-r border-white/10 flex flex-col justify-center">
                <h2 className="text-2xl font-bold text-foreground mb-6">Help Us Improve</h2>
                
                <div className="space-y-4 text-foreground">
                  <p className="text-lg leading-relaxed">
                    Your feedback means the world to us.
                  </p>
                  
                  <p className="leading-relaxed">
                    SimplSEO is growing fast, and every message helps us make the platform smarter, clearer, and more useful for you and your business.
                  </p>
                  
                  <p className="leading-relaxed">
                    If you have a question, run into an issue, or want to recommend a feature, feel free to reach out.
                  </p>
                  
                  <p className="text-lg font-medium mt-6">
                    Tell us what&apos;s on your mind 🧠
                  </p>
                </div>
              </div>

              {/* Right Section - Contact Form */}
              <div className="p-8 lg:p-12 bg-background/20 backdrop-blur-sm">
                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Name */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Name</label>
                    <Input
                      value={formData.name}
                      onChange={(e) => handleInputChange("name", e.target.value)}
                      placeholder="Your name"
                      required
                      className="bg-white/5 border-white/10 backdrop-blur-sm focus:bg-white/10"
                    />
                  </div>

                  {/* Email */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Email</label>
                    <Input
                      type="email"
                      value={formData.email}
                      onChange={(e) => handleInputChange("email", e.target.value)}
                      placeholder="your.email@example.com"
                      required
                      className="bg-white/5 border-white/10 backdrop-blur-sm focus:bg-white/10"
                    />
                  </div>

                  {/* Subject */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Select Subject?</label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => handleInputChange("subject", "question")}
                        className={`p-3 rounded-lg border transition-all ${
                          formData.subject === "question"
                            ? "bg-green-500/20 border-green-500/50 text-foreground"
                            : "bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10"
                        }`}
                      >
                        <div className="flex items-center gap-2 justify-center">
                          <HelpCircle className="w-4 h-4" />
                          <span className="text-sm font-medium">Question</span>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleInputChange("subject", "feedback")}
                        className={`p-3 rounded-lg border transition-all ${
                          formData.subject === "feedback"
                            ? "bg-green-500/20 border-green-500/50 text-foreground"
                            : "bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10"
                        }`}
                      >
                        <div className="flex items-center gap-2 justify-center">
                          <MessageSquare className="w-4 h-4" />
                          <span className="text-sm font-medium">Feedback</span>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleInputChange("subject", "bug")}
                        className={`p-3 rounded-lg border transition-all ${
                          formData.subject === "bug"
                            ? "bg-green-500/20 border-green-500/50 text-foreground"
                            : "bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10"
                        }`}
                      >
                        <div className="flex items-center gap-2 justify-center">
                          <Bug className="w-4 h-4" />
                          <span className="text-sm font-medium">Bug Report</span>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleInputChange("subject", "feature")}
                        className={`p-3 rounded-lg border transition-all ${
                          formData.subject === "feature"
                            ? "bg-green-500/20 border-green-500/50 text-foreground"
                            : "bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10"
                        }`}
                      >
                        <div className="flex items-center gap-2 justify-center">
                          <Lightbulb className="w-4 h-4" />
                          <span className="text-sm font-medium">Feature</span>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Message */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Message</label>
                    <Textarea
                      value={formData.message}
                      onChange={(e) => handleInputChange("message", e.target.value)}
                      placeholder="Write your message..."
                      rows={10}
                      required
                      className="resize-none bg-white/5 border-white/10 backdrop-blur-sm focus:bg-white/10 min-h-[130px]"
                    />

                  </div>

                  {/* Submit Button */}
                  <div className="flex justify-end pt-4 relative">
                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="gap-2 bg-green-600 hover:bg-green-700 text-white shadow-lg"
                    >
                      {isSubmitting ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          Send Message
                        </>
                      )}
                    </Button>

                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}

