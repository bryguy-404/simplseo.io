"use client";
import { authenticatedFetch } from '../lib/authenticatedFetch';


import { useEffect, useState, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useOnboarding } from "../contexts/OnboardingContext";
import MainLayout from "../components/MainLayout";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { 
  MessageSquare, 
  Plus,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Pencil,
  GraduationCap,
  Code,
  Coffee,
  ArrowUp,
  Folder,
  Settings,
  Search,
  Wand2,
  User,
  PanelLeftClose,
  PanelLeftOpen,
  Lightbulb,
  TrendingUp,
  X,
  Edit3,
  Trash2
} from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import SquashBounceLoader from "../components/ui/squash-bounce-loader";
import { fetchChatbotData } from "../lib/chatbotDataFetcher";
import { useMinimumLoading } from "../hooks/use-minimum-loading";
import TypingText from "../components/TypingText";

export default function Chatbot() {
  const { user, isLoading: authLoading } = useAuth();
  const { data } = useOnboarding();
  const router = useRouter();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false); // Loading specific conversation
  const [searchTerm, setSearchTerm] = useState("");
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null); // Ref for scroll container
  const textareaRef = useRef(null);
  const [completedTypingMessages, setCompletedTypingMessages] = useState(new Set());
  const isSavingRef = useRef(false); // Prevent duplicate saves
  const isLoadingHistoryRef = useRef(false); // Track if loading from history

  // ✅ NEW: Chatbot-specific data states
  const [chatbotData, setChatbotData] = useState(null);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const shouldShowLoader = useMinimumLoading(isLoadingData, 2000);

  // Conversation management functions
  const loadConversations = async () => {
    if (!user?.id) return;
    
    setIsLoadingConversations(true);
    try {
      const response = await authenticatedFetch(`/api/conversations?userId=${user.id}&search=${encodeURIComponent(searchTerm)}`);
      const data = await response.json();
      
      if (data.success) {
        setConversations(data.conversations);
      }
    } catch (error) {
      console.error("Error loading conversations:", error);
    } finally {
      setIsLoadingConversations(false);
    }
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
          source: 'main-chatbot'
        })
      });

      const data = await response.json();
      if (data.success) {
        setCurrentConversationId(data.conversationId);
        await loadConversations(); // Refresh the list
        // If it was a duplicate, log it for debugging (optional)
        if (data.isDuplicate) {
          console.log("Duplicate conversation detected and prevented");
        }
        return data.conversationId;
      }
    } catch (error) {
      console.error("Error saving conversation:", error);
    }
  };

  const loadConversation = async (conversationId) => {
    setIsLoadingConversation(true);
    isLoadingHistoryRef.current = true; // Flag to prevent auto-scroll to bottom
    
    const startTime = Date.now();
    const minimumLoadingTime = 1500; // Show loading for at least 800ms
    
    try {
      const response = await authenticatedFetch(`/api/conversations/${conversationId}`);
      const data = await response.json();
      
      if (data.success) {
        const loadedMessages = data.conversation.messages;
        
        // Calculate remaining time to meet minimum loading duration
        const elapsedTime = Date.now() - startTime;
        const remainingTime = Math.max(0, minimumLoadingTime - elapsedTime);
        
        // Wait for remaining time before showing the conversation
        await new Promise(resolve => setTimeout(resolve, remainingTime));
        
        setMessages(loadedMessages);
        // Mark all loaded messages as completed (skip typing animation)
        setCompletedTypingMessages(new Set(loadedMessages.map(msg => msg.id)));
        setCurrentConversationId(conversationId);
        
        // Scroll to top after a brief delay to let messages render
        setTimeout(() => {
          if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTop = 0;
          }
          isLoadingHistoryRef.current = false;
        }, 100);
        
        toast.success("Conversation loaded!");
      }
    } catch (error) {
      console.error("Error loading conversation:", error);
      toast.error("Failed to load conversation");
      isLoadingHistoryRef.current = false;
    } finally {
      setIsLoadingConversation(false);
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

      const data = await response.json();
      if (data.success) {
        await loadConversations(); // Refresh the list
      }
    } catch (error) {
      console.error("Error updating conversation:", error);
    }
  };

  const deleteConversation = async (conversationId) => {
    try {
      const response = await authenticatedFetch(`/api/conversations/${conversationId}`, {
        method: 'DELETE'
      });

      const data = await response.json();
      if (data.success) {
        await loadConversations(); // Refresh the list
        if (currentConversationId === conversationId) {
          setMessages([]);
          setCurrentConversationId(null);
        }
        toast.success("Conversation deleted!");
      }
    } catch (error) {
      console.error("Error deleting conversation:", error);
      toast.error("Failed to delete conversation");
    }
  };

  const renameConversation = async (conversationId, newTitle) => {
    try {
      const response = await authenticatedFetch(`/api/conversations/${conversationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'rename',
          title: newTitle
        })
      });

      const data = await response.json();
      if (data.success) {
        await loadConversations(); // Refresh the list
        toast.success("Conversation renamed!");
      }
    } catch (error) {
      console.error("Error renaming conversation:", error);
      toast.error("Failed to rename conversation");
    }
  };

  const rotatingTitles = [
    "What SEO mess are we cleaning up today?",
    "SEO is hard. Talking to me isn't.",
    "Rankings low? Confidence lower? I got you.",
    "Google's confusing. I'm not.",
    "Your AI sidekick for all things SEO.",
    "Let's fix what Google isn't loving yet."
  ];

  const [currentTitle, setCurrentTitle] = useState("");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState(null);

  // Prewritten prompts for each action button
  const actionPrompts = {
    write: [
      "Write me an improved meta title and description for my top underperforming page.",
      "Draft a blog outline to target a keyword I'm ranking on page 2.",
      "Rewrite one of my existing pages to better match search intent.",
      "Write SEO-friendly alt text for images on my site.",
      "Create an internal linking paragraph that connects my top page to a low-CTR page."
    ],
    learn: [
      "Explain why my impressions are increasing but clicks are not.",
      "Teach me what bounce rate means using my site's data as an example.",
      "What's the difference between indexed and not indexed pages on my site?",
      "Explain how to use keywords I already rank for to improve my SEO.",
      "What is search intent and how does it apply to my top pages?"
    ],
    ideas: [
      "Give me 5 blog post ideas based on keywords I almost rank for.",
      "Suggest FAQ questions for my website that could rank in Google.",
      "What seasonal or trending keywords could I target in my niche?",
      "Suggest content improvements for my homepage.",
      "What related topics are missing from my website?"
    ],
    track: [
      "Show me my top 5 pages that improved the most in the past 30 days.",
      "Track how my click-through rate changes after updating meta titles.",
      "Which keywords moved from page 2 to page 1 this month?",
      "Highlight pages that dropped in ranking and why.",
      "Give me a weekly summary of my SEO performance."
    ]
  };

  useEffect(() => {
    if (typeof window !== "undefined" && !authLoading && !user) {
      router.push("/auth");
    }
  }, [user, authLoading, router]);

  // ✅ NEW: Fetch chatbot data
  useEffect(() => {
    const loadChatbotData = async () => {
      if (!user?.id) {
        setIsLoadingData(false);
        return;
      }

      try {
        console.log("🔍 Fetching chatbot data...");
        const result = await fetchChatbotData(user.id);
        
        if (result.success) {
          setChatbotData(result.data);
          console.log("✅ Chatbot data loaded:", result.data);
        } else {
          console.log("❌ Failed to load chatbot data:", result.error);
          toast.error("Failed to load your data", {
            description: result.error
          });
        }
      } catch (error) {
        console.error("❌ Error loading chatbot data:", error);
        toast.error("Error loading data", {
          description: "Please try refreshing the page"
        });
      } finally {
        setIsLoadingData(false);
      }
    };

    loadChatbotData();
  }, [user]);

  useEffect(() => {
    // Only scroll to bottom for new messages, not when loading history
    if (!isLoadingHistoryRef.current && messages.length > 0) {
      scrollToBottom();
    }
  }, [messages]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    // Randomly select a title when component mounts
    const randomIndex = Math.floor(Math.random() * rotatingTitles.length);
    setCurrentTitle(rotatingTitles[randomIndex]);
  }, []);

  // Load conversations when user is available
  useEffect(() => {
    if (user?.id && !isLoadingData) {
      loadConversations();
    }
  }, [user?.id, isLoadingData, searchTerm]);

  // ✅ NEW: Load saved conversation (no automatic welcome message)
  useEffect(() => {
    const loadSavedConversation = () => {
      const stored = localStorage.getItem("chatbotMessages-v1");
      if (stored) {
        const { messages: savedMessages, timestamp, conversationId } = JSON.parse(stored);
        const now = new Date().getTime();
        const oneHour = 60 * 60 * 1000;

        if (now - timestamp < oneHour && savedMessages.length > 0) {
          setMessages(savedMessages);
          // Mark all loaded messages as completed (skip typing animation on refresh)
          setCompletedTypingMessages(new Set(savedMessages.map(msg => msg.id)));
          // Restore conversation ID so follow-ups update the same conversation
          if (conversationId) {
            setCurrentConversationId(conversationId);
          }
          return;
        }
      }

      // No automatic welcome message - start with empty messages
      setMessages([]);
    };

    // Only load conversation after data is loaded
    if (!isLoadingData) {
      loadSavedConversation();
    }
  }, [isLoadingData]);

  // Mobile detection and sidebar state management
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      
      // On mobile, start with sidebar collapsed
      if (mobile) {
        setIsSidebarCollapsed(true);
      }
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Mobile detection and sidebar state management
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      
      // On mobile, start with sidebar collapsed
      if (mobile) {
        setIsSidebarCollapsed(true);
      }
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);



  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSendMessage = async () => {
    if (!input.trim()) return;

    const userMessage = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: new Date(),
      source: "main-chatbot"
    };

    setMessages(prev => [...prev, userMessage]);
    const userInput = input;
    setInput("");
    setIsThinking(true);

    try {
      // Prepare conversation history (last 10 messages from current conversation)
      const conversationHistory = messages
        .slice(-10) // Keep last 10 messages for context
        .map(msg => ({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content
        }));

      // ✅ NEW: Call dedicated chatbot API with user data
      const res = await authenticatedFetch("/api/chatbot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userInput,
          conversationHistory: conversationHistory,
          userData: {
            userId: user?.id,
            userFirstName: data?.name?.split(' ')[0] || user?.email?.split('@')[0] || 'there',
            businessName: data?.businessName,
            businessLocation: data?.businessLocation,
            websiteUrl: data?.websiteUrl,
            gscKeywords: chatbotData?.gscKeywords || [],
            topPages: chatbotData?.topPages || [],
            lowCtrPages: chatbotData?.lowCtrPages || [],
            aiTips: chatbotData?.aiTips || [],
            easyWins: chatbotData?.easyWins || [],
            impressionTrends: chatbotData?.impressionTrends || [],
            focusKeywords: chatbotData?.focusKeywords || []
          }
        }),
      });

      if (!res.ok) {
        throw new Error(`Chatbot API failed: ${res.status}`);
      }

      const aiResponse = await res.json();
      
      const aiMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: aiResponse.response || "I'm sorry, I couldn't generate a response. Please try again.",
        timestamp: new Date(),
        source: "main-chatbot"
      };
      
      setMessages(prev => {
        const updated = [...prev, aiMessage];
        
        // Save conversation to localStorage (including conversationId for continuity)
        const conversation = {
          messages: updated,
          timestamp: new Date().getTime(),
          conversationId: currentConversationId // Will be updated after Firebase save
        };
        localStorage.setItem("chatbotMessages-v1", JSON.stringify(conversation));

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
            saveConversation(messagesToSave).then(newConversationId => {
              if (newConversationId) {
                setCurrentConversationId(newConversationId);
                // Update localStorage with the new conversationId
                const storedData = localStorage.getItem("chatbotMessages-v1");
                if (storedData) {
                  const parsed = JSON.parse(storedData);
                  parsed.conversationId = newConversationId;
                  localStorage.setItem("chatbotMessages-v1", JSON.stringify(parsed));
                }
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
      console.error("❌ Chatbot API error:", error);
      
      // Fallback response
      const fallbackMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "I'm sorry, I'm having trouble connecting right now. Please try again in a moment! 🤖",
        timestamp: new Date(),
        source: "main-chatbot"
      };
      
      setMessages(prev => [...prev, fallbackMessage]);
      toast.error("Failed to get AI response", {
        description: "Please try again in a moment"
      });
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

  // Handle action button clicks
  const handleActionClick = (action) => {
    if (activeDropdown === action) {
      setActiveDropdown(null);
    } else {
      setActiveDropdown(action);
    }
  };

  // Handle prompt selection
  const handlePromptSelect = (prompt) => {
    setInput(prompt);
    setActiveDropdown(null);
    // Focus the textarea after setting the input
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 100);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (activeDropdown && !event.target.closest('.action-dropdown')) {
        setActiveDropdown(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [activeDropdown]);

  if (authLoading) {
    return null;
  }

  // ✅ NEW: Show loading state while fetching data
  if (shouldShowLoader) {
    return (
      <MainLayout>
        <div className="flex h-[calc(100vh-4rem)] w-full bg-background">
          <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6">
            <div className="text-center w-full max-w-2xl">
              <div className="flex flex-col sm:flex-row items-center justify-center space-y-4 sm:space-y-0 sm:space-x-4 mb-6 sm:mb-8">
                <div className="chatbot-bounce-wrapper">
                  <SquashBounceLoader size="lg" className="text-green-500" />
                </div>
                <h1 className="text-2xl sm:text-3xl font-semibold text-foreground px-4">Loading your SEO data...</h1>
              </div>
              <p className="text-muted-foreground mb-4">
                Fetching your Google Search Console data and SEO insights to give you personalized help!
              </p>
            </div>
          </div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="flex h-[calc(97dvh-4rem)] w-full bg-background z-2">
                {/* Left Sidebar - Sticky and collapsible */}
        <div className={`bg-card border-r border-border flex flex-col flex-shrink-0 transition-all duration-300 ease-in-out ${
          isMobile 
            ? (isSidebarCollapsed ? 'w-0' : 'w-80') 
            : (isSidebarCollapsed ? 'w-16' : 'w-80')
        } ${isMobile ? 'absolute left-0 top-0 h-screen z-20' : 'relative'} ${isMobile && isSidebarCollapsed ? 'overflow-hidden' : ''}`}>
          {/* Header */}
          <div className={`border-b border-border transition-all duration-300 ${
            isSidebarCollapsed ? 'p-4' : 'p-6'
          }`}>
            <div className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-between'} mb-6`}>
              {!isSidebarCollapsed && (
                <div className="flex items-center space-x-2">
                  <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                  </div>
                  <span className="text-lg font-medium text-foreground">SimplSEO Mentor</span>
                </div>
              )}
              <button 
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                className="p-1 hover:bg-muted rounded transition-colors"
              >
                {isSidebarCollapsed ? (
                  <PanelLeftOpen className="w-5 h-5 text-muted-foreground" />
                ) : (
                  <PanelLeftClose className="w-5 h-5 text-muted-foreground" />
                )}
              </button>
            </div>
            
            <Button 
              className={`bg-green-600 hover:bg-green-700 text-white transition-all duration-300 ${
                isSidebarCollapsed ? 'w-8 h-8 p-0' : 'w-full'
              }`}
              onClick={() => {
                setMessages([]);
                setCurrentConversationId(null);
                isSavingRef.current = false; // Reset saving guard
                localStorage.removeItem("chatbotMessages-v1");
                toast.success("New conversation started!");
              }}
            >
              <Plus className="w-4 h-4" />
              {!isSidebarCollapsed && <span className="ml-2">New Chat</span>}
            </Button>
          </div>

          {/* Advanced Tools Section */}
          {/* <div className={`py-2 transition-all duration-300 ${
            isSidebarCollapsed ? 'px-2' : 'px-4'
          }`}>
            <button className={`w-full text-left rounded-lg hover:bg-muted transition-colors flex items-center justify-between ${
              isSidebarCollapsed ? 'px-2 py-2' : 'px-3 py-2'
            }`}>
              <div className="flex items-center space-x-3">
                <Wand2 className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                {!isSidebarCollapsed && <span className="text-foreground">Advanced Tools</span>}
              </div>
              {!isSidebarCollapsed && <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
          </div> */}

          {/* AI Assistants Section */}
          {/* <div className={`py-2 transition-all duration-300 ${
            isSidebarCollapsed ? 'px-2' : 'px-4'
          }`}>
            <button className={`w-full text-left rounded-lg hover:bg-muted transition-colors flex items-center justify-between ${
              isSidebarCollapsed ? 'px-2 py-2' : 'px-3 py-2'
            }`}>
              <div className="flex items-center space-x-3">
                <User className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                {!isSidebarCollapsed && <span className="text-foreground">AI Assistants</span>}
              </div>
              {!isSidebarCollapsed && <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
          </div> */}

          {/* Chat History Panel */}
          <div className={`flex-1 mb-4 mt-4 bg-muted rounded-lg border border-border transition-all duration-300 flex flex-col min-h-0 ${
            isSidebarCollapsed ? 'mx-2 p-2' : 'mx-4 p-4'
          }`}>
            <div className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-between'} mb-4 flex-shrink-0`}>
              <div className="flex items-center space-x-2">
                <MessageSquare className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                {!isSidebarCollapsed && (
                  <>
                    <span className="text-sm font-medium text-foreground">Chat History</span>
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">{conversations.length}</span>
                  </>
                )}
              </div>
            </div>
            
            {!isSidebarCollapsed && (
              <div className="flex flex-col flex-1 min-h-0">
                {/* Search Bar */}
                <div className="mb-3 flex-shrink-0">
                  <Input
                    placeholder="Search conversations..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>

                {/* Conversations List */}
                {isLoadingConversations ? (
                  <div className="text-center py-4 flex-shrink-0">
                    <div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                    <p className="text-xs text-muted-foreground">Loading conversations...</p>
                  </div>
                ) : conversations.length > 0 ? (
                  <div className="space-y-1 flex-1 overflow-y-auto min-h-0 chat-history-scroll">
                    {conversations.map((conversation) => (
                      <div 
                        key={conversation.id}
                        className={`text-xs p-2 rounded cursor-pointer transition-colors group ${
                          currentConversationId === conversation.id 
                            ? 'bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-300' 
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                        }`}
                        onClick={() => loadConversation(conversation.id)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{conversation.title}</p>
                            <p className="text-xs opacity-70">
                              {new Date(conversation.updatedAt).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const newTitle = prompt("Rename conversation:", conversation.title);
                                if (newTitle && newTitle !== conversation.title) {
                                  renameConversation(conversation.id, newTitle);
                                }
                              }}
                              className="p-1 hover:bg-muted rounded"
                              title="Rename"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm("Delete this conversation?")) {
                                  deleteConversation(conversation.id);
                                }
                              }}
                              className="p-1 hover:bg-muted rounded text-red-500"
                              title="Delete"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 flex-1 flex flex-col items-center justify-center">
                    <p className="text-sm text-muted-foreground">No conversations yet</p>
                    <p className="text-xs text-muted-foreground mt-1">Start chatting to see your history here!</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* User Profile */}
          <div className={`border-t border-border transition-all duration-300 ${
            isSidebarCollapsed ? 'p-2' : 'p-4'
          }`}>
            <div className={`flex items-center cursor-pointer ${
              isSidebarCollapsed ? 'justify-center' : 'space-x-3'
            }`}>
              <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-medium flex-shrink-0">
                {data?.name?.charAt(0) || user?.email?.charAt(0) || 'U'}
              </div>
              {!isSidebarCollapsed && (
                <div className="flex-1">
                  <div className="text-sm font-medium text-foreground">{data?.name || user?.email || 'User'}</div>
                  <div className="text-xs text-muted-foreground">SEO Assistant</div>
                </div>
              )}
              {!isSidebarCollapsed && <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </div>
          </div>
        </div>

        {/* Main Chat Area - Takes remaining width, no margins */}
        <div className="flex-1 flex flex-col bg-background relative z-0 overflow-hidden">
          {/* Mobile Backdrop Overlay - Only visible when sidebar is open on mobile */}
          {isMobile && !isSidebarCollapsed && (
            <div 
              className="fixed inset-0 backdrop-blur-sm bg-background/10 z-10"
              onClick={() => setIsSidebarCollapsed(true)}
            />
          )}
          
          {/* Mobile Sidebar Toggle - Only visible when sidebar is closed on mobile */}
          {isMobile && isSidebarCollapsed && (
            <button
              onClick={() => setIsSidebarCollapsed(false)}
              className="absolute top-4 left-4 z-10 p-2 bg-card rounded-lg shadow-lg border border-border hover:bg-muted transition-colors"
            >
              <PanelLeftOpen className="w-5 h-5 text-muted-foreground" />
            </button>
          )}

          {/* Main Chat Area - Messages above, input below */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {messages.length === 0 ? (
              /* Welcome State - Centered when no messages */
              <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 -mt-34 sm:-mt-42">
                <div className="text-center w-full max-w-2xl">
                  <div className="flex flex-col sm:flex-row items-center justify-center space-y-4 sm:space-y-0 sm:space-x-4 mb-4 sm:mb-5">
                    <div className="chatbot-bounce-wrapper">
                      <SquashBounceLoader size="lg" className="text-green-500" />
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-semibold text-foreground px-4">{currentTitle}</h1>
                  </div>
                  
                  {/* Input Field - Same layout as conversation */}
                  <div className="mb-4 sm:mb-5 w-full">
                    <div className="border border-border rounded-lg bg-card">
                      {/* Textarea */}
                      <Textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={`How can I help you today ${data?.name?.split(' ')[0] || 'there'}?`}
                        className="w-full min-h-[100px] sm:min-h-[120px] max-h-[200px] resize-none text-base sm:text-lg placeholder:text-sm sm:placeholder:text-base border-0 focus:ring-0 focus-visible:ring-0 rounded-none transition-all duration-200"
                        disabled={isThinking}
                      />
                      
                      {/* Bottom Controls Row */}
                      <div className="flex items-center justify-end p-2 bg-card">
                        {/* Right side controls */}
                        <div className="flex items-center gap-2">
                          <Button 
                            onClick={handleSendMessage}
                            disabled={!input.trim() || isThinking}
                            className="h-7 w-7 p-0 bg-green-500 hover:bg-green-600"
                          >
                            <ArrowUp className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons with Dropdowns */}
                  <div className="flex flex-row flex-wrap justify-center gap-2 sm:gap-4 px-4 relative">
                         {/* Mobile Dropdown Container - Centered */}
                         <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-[95vw] sm:hidden z-50">
                           {activeDropdown && (
                             <div className="mt-2 bg-card border border-border rounded-lg shadow-lg">
                               <div className="p-2">
                                 <div className="flex justify-between items-center mb-2">
                                   <h3 className="text-sm font-medium text-muted-foreground capitalize">{activeDropdown} Prompts</h3>
                                   <button
                                     onClick={() => setActiveDropdown(null)}
                                     className="p-1 hover:bg-muted rounded-full transition-colors"
                                   >
                                     <X className="w-4 h-4" />
                                   </button>
                                 </div>
                                 {actionPrompts[activeDropdown]?.map((prompt, index) => (
                                   <button
                                     key={index}
                                     className="w-full text-left p-3 hover:bg-muted rounded-lg text-sm transition-colors"
                                     onClick={() => handlePromptSelect(prompt)}
                                   >
                                     {prompt}
                                   </button>
                                 ))}
                               </div>
                             </div>
                           )}
                         </div>
                         {/* Write Button */}
                         <div className="relative action-dropdown">
                           <Button 
                             variant="outline" 
                             className={`flex items-center space-x-2 text-sm sm:text-base px-3 sm:px-4 py-2 ${activeDropdown === 'write' ? 'bg-muted' : ''}`}
                             onClick={() => handleActionClick('write')}
                           >
                             <Pencil className="w-3 h-3 sm:w-4 sm:h-4" />
                             <span>Write</span>
                             <ChevronDown className="w-3 h-3 sm:w-4 sm:h-4" />
                           </Button>
                           {activeDropdown === 'write' && (
                             <div className="hidden sm:block absolute top-full left-0 mt-2 w-[36rem] bg-card border border-border rounded-lg shadow-lg z-50">
                               <div className="p-2">
                                 <div className="flex justify-between items-center mb-2">
                                   <h3 className="text-sm font-medium text-muted-foreground">Write Prompts</h3>
                                   <button
                                     onClick={() => setActiveDropdown(null)}
                                     className="p-1 hover:bg-muted rounded-full transition-colors"
                                   >
                                     <X className="w-4 h-4" />
                                   </button>
                                 </div>
                                 {actionPrompts.write.map((prompt, index) => (
                                   <button
                                     key={index}
                                     className="w-full text-left p-3 hover:bg-muted rounded-lg text-sm transition-colors"
                                     onClick={() => handlePromptSelect(prompt)}
                                   >
                                     {prompt}
                                   </button>
                                 ))}
                               </div>
                             </div>
                           )}
                         </div>

                         {/* Learn Button */}
                         <div className="relative action-dropdown">
                           <Button 
                             variant="outline" 
                             className={`flex items-center space-x-2 text-sm sm:text-base px-3 sm:px-4 py-2 ${activeDropdown === 'learn' ? 'bg-muted' : ''}`}
                             onClick={() => handleActionClick('learn')}
                           >
                             <GraduationCap className="w-3 h-3 sm:w-4 sm:h-4" />
                             <span>Learn</span>
                             <ChevronDown className="w-3 h-3 sm:w-4 sm:h-4" />
                           </Button>
                           {activeDropdown === 'learn' && (
                             <div className="hidden sm:block absolute top-full left-0 mt-2 w-[36rem] bg-card border border-border rounded-lg shadow-lg z-50">
                               <div className="p-2">
                                 <div className="flex justify-between items-center mb-2">
                                   <h3 className="text-sm font-medium text-muted-foreground">Learn Prompts</h3>
                                   <button
                                     onClick={() => setActiveDropdown(null)}
                                     className="p-1 hover:bg-muted rounded-full transition-colors"
                                   >
                                     <X className="w-4 h-4" />
                                   </button>
                                 </div>
                                 {actionPrompts.learn.map((prompt, index) => (
                                   <button
                                     key={index}
                                     className="w-full text-left p-3 hover:bg-muted rounded-lg text-sm transition-colors"
                                     onClick={() => handlePromptSelect(prompt)}
                                   >
                                     {prompt}
                                   </button>
                                 ))}
                               </div>
                             </div>
                           )}
                         </div>

                         {/* Ideas Button */}
                         <div className="relative action-dropdown">
                           <Button 
                             variant="outline" 
                             className={`flex items-center space-x-2 text-sm sm:text-base px-3 sm:px-4 py-2 ${activeDropdown === 'ideas' ? 'bg-muted' : ''}`}
                             onClick={() => handleActionClick('ideas')}
                           >
                             <Lightbulb className="w-3 h-3 sm:w-4 sm:h-4" />
                             <span>Ideas</span>
                             <ChevronDown className="w-3 h-3 sm:w-4 sm:h-4" />
                           </Button>
                           {activeDropdown === 'ideas' && (
                             <div className="hidden sm:block absolute top-full left-0 mt-2 w-[36rem] bg-card border border-border rounded-lg shadow-lg z-50">
                               <div className="p-2">
                                 <div className="flex justify-between items-center mb-2">
                                   <h3 className="text-sm font-medium text-muted-foreground">Ideas Prompts</h3>
                                   <button
                                     onClick={() => setActiveDropdown(null)}
                                     className="p-1 hover:bg-muted rounded-full transition-colors"
                                   >
                                     <X className="w-4 h-4" />
                                   </button>
                                 </div>
                                 {actionPrompts.ideas.map((prompt, index) => (
                                   <button
                                     key={index}
                                     className="w-full text-left p-3 hover:bg-muted rounded-lg text-sm transition-colors"
                                     onClick={() => handlePromptSelect(prompt)}
                                   >
                                     {prompt}
                                   </button>
                                 ))}
                               </div>
                             </div>
                           )}
                         </div>

                         {/* Track Button */}
                         <div className="relative action-dropdown">
                           <Button 
                             variant="outline" 
                             className={`flex items-center space-x-2 text-sm sm:text-base px-3 sm:px-4 py-2 ${activeDropdown === 'track' ? 'bg-muted' : ''}`}
                             onClick={() => handleActionClick('track')}
                           >
                             <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4" />
                             <span>Track</span>
                             <ChevronDown className="w-3 h-3 sm:w-4 sm:h-4" />
                           </Button>
                           {activeDropdown === 'track' && (
                             <div className="hidden sm:block absolute top-full left-0 mt-2 w-[36rem] bg-card border border-border rounded-lg shadow-lg z-50">
                               <div className="p-2">
                                 <div className="flex justify-between items-center mb-2">
                                   <h3 className="text-sm font-medium text-muted-foreground">Track Prompts</h3>
                                   <button
                                     onClick={() => setActiveDropdown(null)}
                                     className="p-1 hover:bg-muted rounded-full transition-colors"
                                   >
                                     <X className="w-4 h-4" />
                                   </button>
                                 </div>
                                 {actionPrompts.track.map((prompt, index) => (
                                   <button
                                     key={index}
                                     className="w-full text-left p-3 hover:bg-muted rounded-lg text-sm transition-colors"
                                     onClick={() => handlePromptSelect(prompt)}
                                   >
                                     {prompt}
                                   </button>
                                 ))}
                               </div>
                             </div>
                           )}
                         </div>
                       </div>
                </div>
              </div>
            ) : (
              /* Messages Display - When conversation exists */
              <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 messages-scroll relative">
                {/* Loading overlay when switching conversations */}
                {isLoadingConversation && (
                  <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-10 flex items-center justify-center">
                    <div className="text-center">
                      <div className="flex space-x-1 justify-center mb-3">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></div>
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></div>
                      </div>
                      <p className="text-sm text-muted-foreground">Loading conversation...</p>
                    </div>
                  </div>
                )}
                <div className="max-w-4xl mx-auto">
                  <div className="space-y-6">
                    {messages.map((message) => (
                      <div
                        key={message.id}
                        className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        <div className={`max-w-[80%] sm:max-w-[80%] ${message.role === "user" ? "order-2" : "order-1"}`}>
                          <div className={`p-4 rounded-lg ${
                            message.role === "user" 
                              ? "bg-green-600 text-white ml-2 sm:ml-4" 
                              : "bg-muted mr-2 sm:mr-4"
                          }`}>
                            {message.role === "user" ? (
                              <p className="whitespace-pre-wrap text-sm sm:text-base leading-relaxed">{message.content}</p>
                            ) : !completedTypingMessages.has(message.id) ? (
                              <div className="text-sm sm:text-base leading-relaxed prose prose-sm sm:prose-base max-w-none dark:prose-invert prose-p:mb-6 prose-headings:mb-4 prose-headings:mt-8 prose-ul:mb-6 prose-ol:mb-6 prose-li:mb-3 prose-strong:font-semibold prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-muted prose-pre:p-4 prose-pre:rounded-lg prose-blockquote:border-l-4 prose-blockquote:border-muted-foreground prose-blockquote:pl-4 prose-blockquote:italic prose-h1:text-xl prose-h1:font-bold prose-h2:text-lg prose-h2:font-semibold prose-h3:text-base prose-h3:font-semibold [&_p]:mb-4 [&_p:last-child]:mb-0 [&_h1]:mb-4 [&_h2]:mb-4 [&_h3]:mb-4 [&_h4]:mb-4 [&_h5]:mb-4 [&_h6]:mb-4 [&_ul]:mb-4 [&_ol]:mb-4 [&_li]:mb-2 [&_blockquote]:mb-4 [&_hr]:my-6 [&_pre]:mb-4 [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_strong]:font-semibold [&_em]:italic" style={{ lineHeight: '1.7' }}>
                                <TypingText
                                  text={message.content}
                                  speed={5}
                                  isMarkdown={true}
                                  onComplete={() => {
                                    setCompletedTypingMessages(prev => new Set([...prev, message.id]));
                                  }}
                                />
                              </div>
                            ) : (
                              <div className="text-sm sm:text-base leading-relaxed prose prose-sm sm:prose-base max-w-none dark:prose-invert prose-p:mb-6 prose-headings:mb-4 prose-headings:mt-8 prose-ul:mb-6 prose-ol:mb-6 prose-li:mb-3 prose-strong:font-semibold prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-muted prose-pre:p-4 prose-pre:rounded-lg prose-blockquote:border-l-4 prose-blockquote:border-muted-foreground prose-blockquote:pl-4 prose-blockquote:italic prose-h1:text-xl prose-h1:font-bold prose-h2:text-lg prose-h2:font-semibold prose-h3:text-base prose-h3:font-semibold [&_p]:mb-4 [&_p:last-child]:mb-0 [&_h1]:mb-4 [&_h2]:mb-4 [&_h3]:mb-4 [&_h4]:mb-4 [&_h5]:mb-4 [&_h6]:mb-4 [&_ul]:mb-4 [&_ol]:mb-4 [&_li]:mb-2 [&_blockquote]:mb-4 [&_hr]:my-6 [&_pre]:mb-4 [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_strong]:font-semibold [&_em]:italic" style={{ lineHeight: '1.7' }}>
                                <ReactMarkdown>{message.content}</ReactMarkdown>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                    
                    {isThinking && (
                      <div className="flex justify-start">
                        <div className="bg-muted p-4 rounded-lg mr-2 sm:mr-4 max-w-[80%]">
                          <div className="flex items-center space-x-2">
                            <div className="flex space-x-1">
                              <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce"></div>
                              <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></div>
                              <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></div>
                            </div>
                            <span className="text-sm text-muted-foreground">Thinking...</span>
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                </div>
              </div>
            )}

            {/* Input Area - Sticky at bottom when conversation exists */}
            {messages.length > 0 && (
              <div className="sticky bottom-0 z-40 border-t border-border bg-background p-4 flex-shrink-0">
                <div className="max-w-4xl mx-auto px-2 sm:px-0">
                  <div className="border border-border rounded-lg bg-card">
                    {/* Textarea */}
                    <Textarea
                      ref={textareaRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Ask away, I'm warmed up now..."
                      className="w-full min-h-[60px] sm:min-h-[60px] max-h-[200px] resize-none text-base border-0 focus:ring-0 focus-visible:ring-0 rounded-none transition-all duration-200"
                      disabled={isThinking}
                    />
                    
                    {/* Bottom Controls Row */}
                    <div className="flex items-center justify-end p-2 bg-card">
                      {/* Right side controls */}
                      <div className="flex items-center gap-2">
                        <Button 
                          onClick={handleSendMessage}
                          disabled={!input.trim() || isThinking}
                          className="h-7 w-7 p-0 bg-green-500 hover:bg-green-600"
                        >
                          <ArrowUp className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                  {/* AI Disclaimer */}
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    SimplSEO Mentor is AI and can make mistakes. Please double-check responses.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <style jsx global>{`
        .chat-history-scroll::-webkit-scrollbar,
        .messages-scroll::-webkit-scrollbar {
          width: 6px;
        }
        .chat-history-scroll::-webkit-scrollbar-track,
        .messages-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .chat-history-scroll::-webkit-scrollbar-thumb,
        .messages-scroll::-webkit-scrollbar-thumb {
          background: rgba(107, 114, 128, 0.3);
          border-radius: 3px;
        }
        .chat-history-scroll::-webkit-scrollbar-thumb:hover,
        .messages-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(107, 114, 128, 0.5);
        }
        /* Firefox scrollbar styling */
        .messages-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(107, 114, 128, 0.3) transparent;
        }
        .chatbot-bounce-wrapper div div {
          animation: chatbotBounce 8s infinite ease-in-out !important;
        }
        @keyframes chatbotBounce {
          0% {
            transform: translateY(0) scaleX(1) scaleY(1);
          }
          1.25% {
            transform: translateY(-20px) scaleX(1.05) scaleY(0.95);
          }
          3.125% {
            transform: translateY(-50px) scaleX(0.95) scaleY(1.05);
          }
          6.25% {
            transform: translateY(0) scaleX(1.2) scaleY(0.8);
          }
          9.375% {
            transform: translateY(-30px) scaleX(0.98) scaleY(1.02);
          }
          12.5%, 87.5% {
            transform: translateY(0) scaleX(1) scaleY(1);
          }
          88.75% {
            transform: translateY(-20px) scaleX(1.05) scaleY(0.95);
          }
          90.625% {
            transform: translateY(-50px) scaleX(0.95) scaleY(1.05);
          }
          93.75% {
            transform: translateY(0) scaleX(1.2) scaleY(0.8);
          }
          96.875% {
            transform: translateY(-30px) scaleX(0.98) scaleY(1.02);
          }
          100% {
            transform: translateY(0) scaleX(1) scaleY(1);
          }
        }
      `}</style>
    </MainLayout>
  );
}
