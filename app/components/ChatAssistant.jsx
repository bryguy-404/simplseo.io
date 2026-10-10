
import { authenticatedFetch } from '../lib/authenticatedFetch';
import React, { useState, useRef, useEffect } from "react";
import { X, Send, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useOnboarding } from "../contexts/OnboardingContext";
import { useAuth } from "../contexts/AuthContext";
import { getFocusKeywords } from "../lib/firestoreHelpers";
import ReactMarkdown from "react-markdown";
import TypingText from "./TypingText";
import { useRouter } from "next/navigation";
import { 
  shouldShowFeedbackPrompt, 
  updatePromptDismissed,
  markFeedbackButtonClicked 
} from "../lib/feedbackPromptTracker";

const ChatAssistant = ({
  onClose,
  aiTips = [],
  gscKeywords = [],
  easyWins = [],
  topPages = [],
  lowCtrPages = [],
  impressionTrends = [],
}) => {
  const { data } = useOnboarding();
  const { user } = useAuth();
  const router = useRouter();
  const firstName = data?.name ? data.name.split(" ")[0] : "";
  // Get current page context for personalized welcome message
  const getPageContext = () => {
    if (typeof window === 'undefined') return null;
    
    const pathname = window.location.pathname;
    const pageContexts = {
      '/dashboard': {
        title: 'Dashboard',
        message: "I see you're on your Dashboard! This shows your SEO progress and recommendations. Need help understanding what you're seeing?",
        help: "I can explain any metric, help you understand the data, or guide you on what to do next."
      },
      '/intent-mismatch': {
        title: 'Intent Mismatch Analysis',
        message: "I see you're on the Intent Mismatch page! This finds when your content doesn't match what people are searching for. Need help understanding what you're seeing?",
        help: "I can explain the scores, help you fix content issues, or show you how to make your pages match what people want."
      },
      '/low-ctr': {
        title: 'Low CTR Fixes',
        message: "I see you're on the Low CTR page! These pages get seen but not clicked. Need help understanding what you're seeing?",
        help: "I can help you write better titles, improve descriptions, or fix why people aren't clicking."
      },
      '/top-keywords': {
        title: 'Top Keywords',
        message: "I see you're on the Top Keywords page! This shows your best-performing search terms. Need help understanding what you're seeing?",
        help: "I can explain which keywords to focus on, how to improve rankings, or find new opportunities."
      },
      '/easy-wins': {
        title: 'Easy Wins',
        message: "I see you're on the Easy Wins page! These are quick SEO fixes you can do right now. Need help understanding what you're seeing?",
        help: "I can help you pick the best wins, guide you through them, or explain what results to expect."
      },
      '/generic-keywords': {
        title: 'Generic Keywords Analysis',
        message: "I see you're on the AI Generic Keywords page! This analyzes broad, non-branded keywords that could bring in new traffic. Need help understanding what you're seeing?",
        help: "I can explain the keyword analysis, help you understand the opportunities, or guide you on how to optimize for these generic terms."
      },
      '/generic-keywords-ranking': {
        title: 'Generic Keywords Already Ranking',
        message: "I see you're on the Generic Keywords Already Ranking page! This shows non-branded keywords you're already ranking for in Google Search Console. Need help understanding what you're seeing?",
        help: "I can explain which keywords are performing well, help you understand the metrics (clicks, impressions, CTR, position), or guide you on how to improve these rankings further."
      },
      '/chatbot': {
        title: 'SEO Mentor Chat',
        message: "I see you're in the SEO Mentor chat! This is your personal SEO help space. What would you like to work on?",
        help: "I can answer any SEO question, analyze your data, or guide you through optimizations."
      },
      '/settings': {
        title: 'Settings',
        message: "I see you're in your Settings! This is where you can customize your SEO experience. Need help understanding any settings?",
        help: "I can explain what each setting does, help you configure your preferences, or guide you through account management."
      }
    };
    
    return pageContexts[pathname] || {
      title: 'SEO Assistant',
      message: "I'm here to help with all your SEO needs! Need help understanding what you're seeing?",
      help: "I can answer questions, provide recommendations, or guide you through any SEO challenge."
    };
  };

  const pageContext = getPageContext();
  const defaultWelcome = {
    id: "welcome",
    role: "assistant",
    content:
      `**Hey${firstName ? ` ${firstName}` : ""}! I'm your personal SEO Mentor**  \n\n${pageContext.message}\n\n${pageContext.help}\n\nJust type your question below to get started!`,
    timestamp: new Date(),
  };
  const [messages, setMessages] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoadingConversation, setIsLoadingConversation] = useState(true);
  const [completedTypingMessages, setCompletedTypingMessages] = useState(new Set());
  const isSavingRef = useRef(false); // Prevent duplicate saves
  const [focusKeywords, setFocusKeywords] = useState([]);
  const [showFeedbackPrompt, setShowFeedbackPrompt] = useState(false);

  // Conversation management functions
  const loadConversations = async (includeActiveCorner = false) => {
    if (!user?.id) return null;
    
    try {
      const url = `/api/conversations?userId=${user.id}${includeActiveCorner ? '&includeActiveCorner=true' : ''}`;
      const response = await authenticatedFetch(url);
      const result = await response.json();
      
      if (result.success) {
        setConversations(result.conversations);
        return result.conversations; // Return conversations for reuse
      }
    } catch (error) {
      console.error("Error loading conversations:", error);
    }
    return null;
  };

  const saveConversation = async (messagesToSave) => {
    if (!user?.id || !messagesToSave.length) return;

    try {
      const response = await authenticatedFetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          messages: messagesToSave,
          source: 'corner-bubble'
        })
      });

      const result = await response.json();
      if (result.success) {
        setCurrentConversationId(result.conversationId);
        await loadConversations();
        // If it was a duplicate, log it for debugging (optional)
        if (result.isDuplicate) {
          console.log("Duplicate conversation detected and prevented");
        }
        return result.conversationId;
      }
    } catch (error) {
      console.error("Error saving conversation:", error);
    }
  };

  const updateConversation = async (conversationId, messagesToUpdate) => {
    try {
      const response = await authenticatedFetch(`/api/conversations/${conversationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addMessage',
          messages: messagesToUpdate
        })
      });

      const result = await response.json();
      if (result.success) {
        await loadConversations();
      }
    } catch (error) {
      console.error("Error updating conversation:", error);
    }
  };

  const endConversationInCorner = async (conversationId) => {
    if (!conversationId) return;
    
    try {
      const response = await authenticatedFetch(`/api/conversations/${conversationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cornerEnd',
          cornerEnded: true
        })
      });

      const result = await response.json();
      if (result.success) {
        await loadConversations();
      }
    } catch (error) {
      console.error("Error ending conversation in corner:", error);
    }
  };

  // Load most recent conversation from already-fetched conversations list
  const loadMostRecentConversationFromList = async (conversationsList) => {
    if (!conversationsList || conversationsList.length === 0) return false;
    
    try {
      // Find the most recent conversation that was started in the corner bubble
      // and hasn't been ended in the corner bubble
      const cornerConversation = conversationsList.find(conv => 
        (conv.source === 'corner-bubble' || 
         (conv.messages && conv.messages.length > 0 && conv.messages[0].source === 'corner-bubble')) &&
        !conv.cornerEnded // Not ended in corner bubble
      );
      
      if (cornerConversation) {
        // Load the full conversation (we need the messages)
        const conversationResponse = await authenticatedFetch(`/api/conversations/${cornerConversation.id}`);
        const conversationResult = await conversationResponse.json();
        
        if (conversationResult.success) {
          const loadedMessages = conversationResult.conversation.messages;
          setMessages(loadedMessages);
          // Mark all loaded messages as completed (skip typing animation)
          setCompletedTypingMessages(new Set(loadedMessages.map(msg => msg.id)));
          setCurrentConversationId(cornerConversation.id);
          return true; // Successfully loaded a corner conversation
        }
      }
    } catch (error) {
      console.error("Error loading most recent conversation:", error);
    }
    return false; // No corner conversation loaded
  };
  const [input, setInput] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("chatAssistantDraft") || "";
    }
    return "";
  });
  const [isThinking, setIsThinking] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [chatWidth, setChatWidth] = useState(384); // Default width (w-96)
  const [chatHeight, setChatHeight] = useState(500); // Default height
  const [isDesktop, setIsDesktop] = useState(false);
  const inputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const resizeRef = useRef(null);

  // Load conversations and most recent conversation when component mounts
  // Optimized: Single API call for conversations, reuse data for finding most recent
  useEffect(() => {
    if (user?.id && !isInitialized) {
      const initializeChat = async () => {
        setIsLoadingConversation(true);
        
        // Check if we should skip loading old conversation (user clicked "End Conversation")
        const skipLoad = localStorage.getItem("skipLoadConversation");
        if (skipLoad === "true") {
          // Clear the flag and start fresh
          localStorage.removeItem("skipLoadConversation");
          // Still load conversations list (for history), but don't load most recent
          await loadConversations(false);
          setMessages([defaultWelcome]);
        } else {
          // Single call with includeActiveCorner=true to get both list AND active conversations
          const conversationsList = await loadConversations(true);
          
          // Use the same data to find and load most recent conversation
          const conversationLoaded = await loadMostRecentConversationFromList(conversationsList);
          
          // If no conversation was loaded, show welcome message
          if (!conversationLoaded) {
            setMessages([defaultWelcome]);
          }
        }
        
        setIsInitialized(true);
        setIsLoadingConversation(false);
      };
      initializeChat();
    }
  }, [user?.id, isInitialized]);

  // Fetch focus keywords
  useEffect(() => {
    const loadFocusKeywords = async () => {
      if (!user?.id) return;
      try {
        const keywords = await getFocusKeywords(user.id);
        setFocusKeywords(keywords || []);
      } catch (error) {
        console.error("Failed to load focus keywords:", error);
        setFocusKeywords([]);
      }
    };
    loadFocusKeywords();
  }, [user?.id]);

  // Check if feedback prompt should be shown
  useEffect(() => {
    const checkFeedbackPrompt = async () => {
      if (!user?.id) return;
      
      try {
        const shouldShow = await shouldShowFeedbackPrompt(user.id);
        if (shouldShow) {
          setShowFeedbackPrompt(true);
        }
      } catch (error) {
        console.error("Error checking feedback prompt:", error);
      }
    };
    
    // Check after chat is initialized
    if (isInitialized) {
      checkFeedbackPrompt();
    }
  }, [user?.id, isInitialized]);

  const handleLeaveFeedback = async () => {
    if (user?.id) {
      await markFeedbackButtonClicked(user.id);
    }
    setShowFeedbackPrompt(false);
    router.push("/contact");
    onClose(); // Close chat when redirecting
  };

  const handleDismissFeedback = async () => {
    if (user?.id) {
      await updatePromptDismissed(user.id);
    }
    setShowFeedbackPrompt(false);
  };

  // Check for stored chat context when component mounts
  useEffect(() => {
    const chatContext = localStorage.getItem("chatContext");
    if (chatContext) {
      try {
        const context = JSON.parse(chatContext);
        if (context.type === "intent_mismatch") {
          // Add the context message to the chat
          const contextMessage = {
            id: Date.now().toString(),
            role: "user",
            content: context.message,
            timestamp: new Date(),
            source: "corner-bubble",
          };
          
          setMessages(prev => [...prev, contextMessage]);
          
          // Clear the stored context after using it
          localStorage.removeItem("chatContext");
          
          // Automatically send the message to get AI response
          setTimeout(() => {
            sendMessageToAI(contextMessage.content, context.mismatch);
          }, 1000);
        } else if (context.type === "focus_keywords") {
          // Add the context message to the chat
          const contextMessage = {
            id: Date.now().toString(),
            role: "user",
            content: context.message,
            timestamp: new Date(),
            source: "corner-bubble",
          };
          
          setMessages(prev => [...prev, contextMessage]);
          
          // Clear the stored context after using it
          localStorage.removeItem("chatContext");
          
          // Automatically send the message to get AI response with focus keyword context
          setTimeout(() => {
            sendMessageToAI(contextMessage.content, context.focusKeywordContext);
          }, 1000);
        }
      } catch (error) {
        console.error("Error parsing chat context:", error);
      }
    }
  }, []);

  // Function to send message to AI (separate from handleSendMessage)
  const sendMessageToAI = async (messageContent, pageContext = null) => {
    setIsThinking(true);
    
    try {
      // Prepare conversation history (exclude welcome message and system messages)
      const conversationHistory = messages
        .filter(msg => msg.role !== "assistant" || !msg.id?.includes("welcome"))
        .slice(-10) // Keep last 10 messages for context
        .map(msg => ({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content
        }));

      // Determine if this is focus keyword context
      const isFocusKeywordContext = pageContext && pageContext.selectedKeywords !== undefined;

      const res = await authenticatedFetch("/api/seo-assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: messageContent,
          conversationHistory: conversationHistory,
          userId: user?.id,
          context: {
            aiTips,
            gscKeywords,
            easyWins,
            topPages,
            lowCtrPages,
            impressionTrends,
            onboarding: data,
            focusKeywords, // Add focus keywords to context
            // Enhanced context for better responses
            currentPage: typeof window !== 'undefined' ? window.location.pathname : '/dashboard',
            userFirstName: firstName,
            timestamp: new Date().toISOString(),
            // Include comprehensive page context if available
            pageContext: pageContext ? {
              targetKeyword: pageContext.targetKeyword,
              pageUrl: pageContext.currentPageUrl,
              matchScore: pageContext.currentMatchScore,
              pageStructure: pageContext.pageStructure,
              fullPageContent: pageContext.fullPageContent,
              allHeadings: pageContext.allHeadings,
              seoGuidance: pageContext.seoGuidance
            } : null,
            // Include focus keyword context if available
            focusKeywordContext: isFocusKeywordContext ? pageContext : null,
          },
        }),
      });

      const { reply } = await res.json();

      const assistantMessage = {
        id: Date.now().toString(),
        role: "assistant",
        content: reply,
        timestamp: new Date(),
        source: "corner-bubble",
      };

      setMessages(prev => {
        const updated = [...prev, assistantMessage];
        
        // Save to Firebase (use functional update to get latest messages)
        const messagesToSave = updated;
        if (currentConversationId) {
          // Update existing conversation
          updateConversation(currentConversationId, messagesToSave);
        } else {
          // Create new conversation
          saveConversation(messagesToSave).then(conversationId => {
            if (conversationId) {
              setCurrentConversationId(conversationId);
            }
          });
        }
        
        return updated;
      });
    } catch (error) {
      console.error("OpenAI error:", error);
      setMessages(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "assistant",
          content:
            "Sorry, something went wrong while trying to give you SEO advice. Try again shortly.",
          timestamp: new Date(),
          source: "corner-bubble",
        },
      ]);
    } finally {
      setIsThinking(false);
    }
  };

  // Note: Conversations are now saved to Firebase instead of localStorage

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Check if desktop on mount and window resize
  useEffect(() => {
    const checkDesktop = () => setIsDesktop(window.innerWidth >= 768);
    checkDesktop();
    window.addEventListener('resize', checkDesktop);
    return () => window.removeEventListener('resize', checkDesktop);
  }, []);

  // Resize functionality - width and height (desktop only)
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing) return;
      
      // Calculate width based on distance from right edge of screen
      // When dragging left (towards screen edge), chat gets smaller
      // When dragging right (away from screen edge), chat gets bigger
      const rightEdge = window.innerWidth - 24; // 24px margin from right edge
      const newWidth = Math.min(Math.max(320, rightEdge - e.clientX), window.innerWidth - 48);
      setChatWidth(newWidth);
      
      // Calculate height based on distance from bottom edge of screen (desktop only)
      // When dragging up, chat gets taller; when dragging down, chat gets shorter
      const bottomEdge = window.innerHeight - 100; // Account for bottom margin
      const newHeight = Math.min(Math.max(350, bottomEdge - e.clientY), window.innerHeight - 120);
      setChatHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const handleResizeStart = (e) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
    if (!isExpanded) {
      setChatWidth(Math.min(800, window.innerWidth - 48));
      setChatHeight(Math.min(700, window.innerHeight - 120));
    } else {
      setChatWidth(384);
      setChatHeight(500);
    }
  };

  const handleUploadImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const imageMessage = {
        id: Date.now().toString(),
        role: "user",
        type: "image",
        content: reader.result, // base64
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, imageMessage]);
    };
    reader.readAsDataURL(file);
  };

  const handleSendMessage = async () => {
    if (!input.trim()) return;

    const userMessage = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: new Date(),
      source: "corner-bubble",
    };

    setMessages((prev) => [...prev, userMessage]);
    const userInput = input;
    setInput("");
    localStorage.removeItem("chatAssistantDraft");
    setIsThinking(true);

    try {
      // Prepare conversation history (exclude welcome message and system messages)
      const conversationHistory = messages
        .filter(msg => msg.role !== "assistant" || !msg.id?.includes("welcome"))
        .slice(-10) // Keep last 10 messages for context
        .map(msg => ({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content
        }));

      const res = await authenticatedFetch("/api/seo-assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userInput,
          conversationHistory: conversationHistory,
          userId: user?.id,
          context: {
            aiTips,
            gscKeywords,
            easyWins,
            topPages,
            lowCtrPages,
            impressionTrends,
            onboarding: data,
            focusKeywords, // Add focus keywords to context
            // Enhanced context for better responses
            currentPage: typeof window !== 'undefined' ? window.location.pathname : '/dashboard',
            userFirstName: firstName,
            timestamp: new Date().toISOString(),
          },
        }),
      });

      const { reply } = await res.json();

      const assistantMessage = {
        id: Date.now().toString(),
        role: "assistant",
        content: reply,
        timestamp: new Date(),
        source: "corner-bubble",
      };

      setMessages((prev) => {
        const updated = [...prev, assistantMessage];
        
        // Save to Firebase (use functional update to ensure we have latest messages)
        // Prevent duplicate saves with ref guard
        if (!isSavingRef.current) {
          isSavingRef.current = true;
          const messagesToSave = updated;
          
          if (currentConversationId) {
            // Update existing conversation
            updateConversation(currentConversationId, messagesToSave).finally(() => {
              isSavingRef.current = false;
            });
          } else {
            // Create new conversation (only if not already saving)
            saveConversation(messagesToSave).then(conversationId => {
              if (conversationId) {
                setCurrentConversationId(conversationId);
              }
              isSavingRef.current = false;
            }).catch(() => {
              isSavingRef.current = false;
            });
          }
        }
        
        return updated;
      });
    } catch (error) {
      console.error("OpenAI error:", error);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "assistant",
          content:
            "Sorry, something went wrong while trying to give you SEO advice. Try again shortly.",
          timestamp: new Date(),
          source: "corner-bubble",
        },
      ]);
    } finally {
      setIsThinking(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const endConversation = async () => {
    // Mark the current conversation as ended in corner bubble
    if (currentConversationId) {
      await endConversationInCorner(currentConversationId);
    }
    
    // Set flag to prevent loading old conversation when chat reopens
    localStorage.setItem("skipLoadConversation", "true");
    
    // Clear all conversation state
    localStorage.removeItem("seoChatMessages");
    localStorage.removeItem("chatContext"); // Also clear any stored context
    localStorage.removeItem("chatAssistantDraft");
    setCurrentConversationId(null);
    setMessages([]); // Clear messages
    setCompletedTypingMessages(new Set()); // Clear completed typing messages
    isSavingRef.current = false; // Reset saving guard
    
    // Close the window like clicking the X button
    // Note: Component will unmount, so isInitialized will reset automatically
    onClose();
  };

  return (
    <div 
      className="flex flex-col overflow-hidden rounded-xl bg-white/1 backdrop-blur-md border border-white/10 shadow-md relative"
      style={{ 
        width: `${chatWidth}px`,
        height: isDesktop ? `${chatHeight}px` : '500px'
      }}
    >
      <div className="p-3 border-b border-border flex justify-between items-center bg-[#00bf63]/8">
        <div className="flex items-center gap-2">
          <h2 className="font-medium text-sm">SEO Mentor</h2>
        </div>
        <div className="flex items-center gap-1">
          {/* Expand/Minimize Button - Desktop Only */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleExpanded}
            className="h-6 w-6 hidden md:flex"
            title={isExpanded ? "Minimize" : "Expand"}
          >
            {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-6 w-6"
            title="Close chat (conversation will resume when reopened)"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 p-3 overflow-y-auto">
        <div className="space-y-3">
          {isLoadingConversation ? (
            <div className="flex justify-start">
              <div className="bg-muted max-w-[85%] rounded-2xl p-2.5">
                <div className="flex space-x-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#00bf63] animate-pulse"></div>
                  <div className="w-1.5 h-1.5 rounded-full bg-[#00bf63] animate-pulse delay-75"></div>
                  <div className="w-1.5 h-1.5 rounded-full bg-[#00bf63] animate-pulse delay-150"></div>
                </div>
                {/* <p className="text-xs text-muted-foreground mt-1">Loading conversation...</p> */}
              </div>
            </div>
          ) : (
            <>
              {/* Feedback Prompt */}
              {showFeedbackPrompt && (
                <div className="bg-gradient-to-r from-green-500/20 to-blue-500/20 border-2 border-green-500/50 rounded-lg p-4 mb-3">
                  <div className="flex items-start gap-3">
                    <div className="text-2xl flex-shrink-0">💬</div>
                    <div className="flex-1">
                      <h3 className="font-semibold mb-2 text-foreground">We'd love your feedback!</h3>
                      <p className="text-sm text-muted-foreground mb-3">
                        You've been using SimplSEO for a while. How's it going? 
                        Your feedback helps us improve!
                      </p>
                      <div className="flex gap-2">
                        <Button
                          onClick={handleLeaveFeedback}
                          className="bg-green-600 hover:bg-green-700 text-white"
                          size="sm"
                        >
                          Leave Feedback
                        </Button>
                        <Button
                          onClick={handleDismissFeedback}
                          variant="outline"
                          size="sm"
                        >
                          Maybe Later
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${
                    message.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl p-2.5 ${
                      message.role === "user"
                        ? "bg-[#00bf63] text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    <div className="text-sm whitespace-pre-wrap">
                      {message.type === "image" ? (
                        <img
                          src={message.content}
                          alt="User uploaded"
                          className="rounded-md max-w-full h-auto"
                        />
                      ) : message.role === "assistant" && !completedTypingMessages.has(message.id) ? (
                        <TypingText
                          text={message.content}
                          speed={5}
                          isMarkdown={true}
                          onComplete={() => {
                            setCompletedTypingMessages(prev => new Set([...prev, message.id]));
                          }}
                          className="prose prose-sm max-w-none dark:prose-invert prose-p:mb-2 prose-headings:mb-2 prose-headings:mt-4 prose-ul:mb-2 prose-ol:mb-2 prose-li:mb-1 prose-strong:font-semibold prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-muted prose-pre:p-4 prose-pre:rounded-lg prose-blockquote:border-l-4 prose-blockquote:border-muted-foreground prose-blockquote:pl-4 prose-blockquote:italic"
                        />
                      ) : (
                        <ReactMarkdown>{message.content}</ReactMarkdown>
                      )}
                    </div>
                    <p className="text-xs opacity-70 mt-1">
                      {new Date(message.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
              ))}

              {isThinking && (
                <div className="flex justify-start">
                  <div className="bg-muted max-w-[85%] rounded-2xl p-2.5">
                    <div className="flex space-x-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#00bf63] animate-pulse"></div>
                      <div className="w-1.5 h-1.5 rounded-full bg-[#00bf63] animate-pulse delay-75"></div>
                      <div className="w-1.5 h-1.5 rounded-full bg-[#00bf63] animate-pulse delay-150"></div>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </>
          )}
        </div>
      </ScrollArea>

      <div className="p-3 border-t border-border">
        <div className="flex gap-2 items-end">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              localStorage.setItem("chatAssistantDraft", e.target.value);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ask me anything about SEO..."
            className="min-h-[40px] max-h-[100px] resize-none text-base md:text-sm px-4 py-2"
            disabled={isThinking}
          />

          {/* <div>
            <input
              id="upload-image"
              type="file"
              accept="image/*"
              ref={fileInputRef}
              onChange={handleUploadImage}
              disabled={isThinking}
              className="hidden"
            />

            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-full h-9 w-9 flex-shrink-0 cursor-pointer"
              disabled={isThinking}
            >
              +
            </Button>
          </div> */}

          <Button
            onClick={handleSendMessage}
            disabled={!input.trim() || isThinking}
            size="icon"
            className="rounded-full h-9 w-9 flex-shrink-0 bg-[#00bf63]"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>

        {/* 🔻 End Conversation Button */}
        <div className="text-center mt-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-destructive"
            onClick={endConversation}
            title="End this conversation and start fresh next time"
          >
            End Conversation
          </Button>
        </div>
      </div>

      {/* Resize Handle - Desktop Only - Top Left Corner */}
      <div 
        ref={resizeRef}
        className="absolute top-0 left-0 w-4 h-4 cursor-nw-resize hidden md:block hover:bg-[#00bf63]/20 transition-colors rounded-br-lg"
        onMouseDown={handleResizeStart}
        title="Drag to resize"
      >
        <div className="w-full h-full flex items-center justify-center">
          <div className="w-2 h-2 bg-[#00bf63]/40 rounded-full"></div>
        </div>
      </div>
    </div>
  );
};

export default ChatAssistant;
