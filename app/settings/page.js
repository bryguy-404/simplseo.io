"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { deleteUser, reauthenticateWithCredential, reauthenticateWithPopup, EmailAuthProvider } from "firebase/auth";
import { User, Bell, Shield, Globe, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";
import { useOnboarding } from "../contexts/OnboardingContext";
import { authenticatedFetch } from "../lib/authenticatedFetch";
import { reconnectGsc } from "../lib/reconnectGsc";
import { notificationAuthPath, notificationReturnFromLocation } from "../lib/notificationNavigation";
import MainLayout from "../components/MainLayout";
import BrandLoader, { PageLoader } from "../components/BrandLoader";
import NotificationPreferences from "../components/notifications/NotificationPreferences";
import OnboardingWorkspace from "../components/onboarding/OnboardingWorkspace";
import RevampModal from "../components/settings/RevampModal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

// Keep existing notification and connection deep links compatible.
const tabs = [
  { id: "profile", label: "Business details", icon: User },
  { id: "integrations", label: "Google connection", icon: Globe },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "account", label: "Account", icon: Shield },
];

function SettingsWorkspace() {
  const { user, isLoading: authLoading } = useAuth();
  const { data, isLoaded, setupWorkspace, setupError, refreshSetup } = useOnboarding();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab = tabs.some(tab => tab.id === requestedTab) ? requestedTab : "profile";
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [connectionNotice, setConnectionNotice] = useState("");
  const [retryingProfile, setRetryingProfile] = useState(false);
  const [showRevampModal, setShowRevampModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isGoogleUser, setIsGoogleUser] = useState(false);
  const activeUser = useRef(user?.id);
  activeUser.current = user?.id;

  useEffect(() => {
    if (!authLoading && !user) router.replace(notificationAuthPath("/auth", notificationReturnFromLocation(window.location)));
  }, [user, authLoading, router]);

  useEffect(() => {
    let active = true;
    activeUser.current = user?.id;
    setIsGoogleUser(false);
    if (user) import("../lib/firebaseConfig").then(({ auth }) => {
      if (active) setIsGoogleUser(Boolean(auth.currentUser?.providerData.some(provider => provider.providerId === "google.com")));
    });
    return () => { active = false; activeUser.current = null; };
  }, [user]);

  const changeTab = value => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", value);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const reconnect = async () => {
    if (isReconnecting || !data.gscProperty) return;
    const uid = user.id;
    setIsReconnecting(true); setConnectionError(""); setConnectionNotice("");
    try {
      const result = await reconnectGsc(data.gscProperty);
      if (activeUser.current !== uid) return;
      if (!result.connected || result.property !== data.gscProperty) throw new Error("Google reconnection could not be confirmed. Please try again.");
      setConnectionNotice("Google is reconnected. Your saved plans and page tracking are unchanged.");
    } catch (error) {
      if (activeUser.current === uid) setConnectionError(error.message || "Google could not reconnect. Please try again.");
    } finally {
      if (activeUser.current === uid) setIsReconnecting(false);
    }
  };

  const retryProfile = async () => {
    setRetryingProfile(true);
    try { await refreshSetup(); } catch { /* The shared setup error provides the retry message. */ }
    finally { setRetryingProfile(false); }
  };

  const closeDeleteDialog = open => {
    if (isDeleting) return;
    setShowDeleteDialog(open);
    if (!open) { setDeleteConfirmation(""); setDeletePassword(""); }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== "DELETE") {
      toast.error("Please type 'DELETE' to confirm account deletion");
      return;
    }

    setIsDeleting(true);
    try {
      const { auth } = await import("../lib/firebaseConfig");
      const currentUser = auth.currentUser;
      
      if (!currentUser) throw new Error("Sign in again before deleting your account.");

      // Check if user signed up with Google OAuth
      const isGoogleUser = currentUser.providerData.some(provider => provider.providerId === 'google.com');
      
      if (isGoogleUser) {
        // For Google OAuth users, we need to re-authenticate with Google
        // This will open a popup for Google re-authentication
        const provider = new (await import("firebase/auth")).GoogleAuthProvider();
        provider.addScope('email');
        provider.addScope('profile');
        
        try {
          await reauthenticateWithPopup(currentUser, provider);
        } catch (reauthError) {
          if (reauthError.code === 'auth/popup-closed-by-user') {
            toast.error("Re-authentication cancelled", {
              description: "Please complete Google re-authentication to delete your account."
            });
            return;
          }
          throw reauthError;
        }
      } else {
        // For email/password users, require password
        if (!deletePassword) {
          toast.error("Please enter your password to confirm account deletion");
          return;
        }
        
        const credential = EmailAuthProvider.credential(user.email, deletePassword);
        await reauthenticateWithCredential(currentUser, credential);
      }
      
      // Delete all user data from Firestore via API (uses Admin SDK)
      const deleteRes = await authenticatedFetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });

      if (!deleteRes.ok) {
        const errorData = await deleteRes.json();
        throw new Error(errorData.error || "Failed to delete user data");
      }

      const deleteData = await deleteRes.json();
      console.log(`✅ Deleted ${deleteData.deletedCount} documents`);
      
      // Delete the Firebase Auth user
      await deleteUser(currentUser);
      
      toast.success("Account deleted successfully");
      
      // Redirect to auth page
      router.push("/auth");
    } catch (error) {
      console.error("Error deleting account:", error);
      
      if (error.code === "auth/wrong-password") {
        toast.error("Incorrect password", {
          description: "Please enter the correct password for this account."
        });
      } else if (error.code === "auth/too-many-requests") {
        toast.error("Too many attempts", {
          description: "Please wait a moment before trying again."
        });
      } else if (error.code === "auth/popup-closed-by-user") {
        toast.error("Re-authentication cancelled", {
          description: "Please complete Google re-authentication to delete your account."
        });
      } else {
        toast.error("Failed to delete account", {
          description: error.message || "Please try again or contact support."
        });
      }
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
      setDeleteConfirmation("");
      setDeletePassword("");
    }
  };

  if (authLoading || !user) return null;

  return (
    <MainLayout>
      <div className="mx-auto w-full max-w-4xl space-y-7 px-4 py-8 sm:px-6 sm:py-10">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-2 text-muted-foreground">Your business details, Google connection, and account preferences.</p>
        </header>
        {!isLoaded ? <PageLoader compact label="Loading your saved settings…" /> : (
          <Tabs value={activeTab} onValueChange={changeTab} className="gap-6">
            <TabsList aria-label="Settings sections" className="grid h-auto w-full grid-cols-2 gap-1 p-1 sm:grid-cols-4">
              {tabs.map(({ id, label, icon: Icon }) => (
                <TabsTrigger key={id} value={id} className="min-h-11 whitespace-normal px-2 py-3 text-sm">
                  <Icon aria-hidden="true" className="size-4 shrink-0" />{label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="profile" className="min-w-0">
              {setupError ? (
                <Card><CardHeader><CardTitle>Your business details</CardTitle></CardHeader><CardContent className="space-y-3">
                  <p role="alert" className="text-sm text-destructive">{setupError}</p>
                  <Button variant="outline" disabled={retryingProfile} onClick={retryProfile}>{retryingProfile ? "Loading…" : "Reload business details"}</Button>
                </CardContent></Card>
              ) : setupWorkspace?.eligible || setupWorkspace?.pinned ? (
                <OnboardingWorkspace key={user.id} existing />
              ) : (
                <Card>
                  <CardHeader><CardTitle>Your business details</CardTitle><CardDescription>The saved information used to understand your business.</CardDescription></CardHeader>
                  <CardContent className="space-y-5">
                    <dl className="grid gap-5 text-sm sm:grid-cols-2">
                      {[["Business name", data.businessName], ["Website", data.websiteUrl], ["Business type", data.customBusinessType || data.businessType], ["Location", data.businessLocation], ["Website platform", data.cmsPlatform]].map(([label, value]) => (
                        <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-medium">{value || "Not provided"}</dd></div>
                      ))}
                    </dl>
                    <p className="text-sm text-muted-foreground">To update these details, <Link href="/contact" className="underline">contact us</Link>. Guided editing will appear here when available for your account.</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="integrations" className="min-w-0 space-y-6">
              <Card>
                <CardHeader><CardTitle>Google Search Console</CardTitle><CardDescription>Connect Google so SimplSEO can review your website’s search activity.</CardDescription></CardHeader>
                <CardContent className="space-y-5">
                  {data.gscProperty ? <>
                    <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">Your selected Google website</p><p className="mt-1 break-all font-medium">{data.gscProperty}</p></div>
                    <p className="text-sm text-muted-foreground">Reconnect if Google access has expired or your search data cannot refresh. Reconnecting keeps the same website and saved work.</p>
                    <Button variant="outline" disabled={isReconnecting} onClick={reconnect}>{isReconnecting && <BrandLoader className="size-4" />}{isReconnecting ? "Waiting for Google…" : "Reconnect Google"}</Button>
                  </> : <>
                    <p className="text-sm">No Google website is selected.</p>
                    {data.isComplete ? <p className="text-sm text-muted-foreground"><Link href="/contact" className="underline">Contact us</Link> to restore your website connection while keeping your saved work.</p> : <Button asChild><Link href="/onboarding">Connect Google</Link></Button>}
                  </>}
                  {connectionError && <p role="alert" className="text-sm text-destructive">{connectionError}</p>}
                  {connectionNotice && <p role="status" className="text-sm">{connectionNotice}</p>}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Website setup</CardTitle><CardDescription>Review your tracked pages or manage a website redesign.</CardDescription></CardHeader>
                <CardContent className="space-y-5">
                  <div className="flex flex-wrap gap-3">
                    <Button variant="outline" asChild><Link href="/revamp">Review website setup</Link></Button>
                    <Button variant="ghost" asChild><Link href="/revamp/history">Previous website work</Link></Button>
                  </div>
                  {data.isComplete && <details className="rounded-lg border p-4">
                    <summary className="cursor-pointer font-medium">Redesigned your website?</summary>
                    <p className="mt-3 text-sm text-muted-foreground">Start a website update after publishing a redesign. Your previous work is kept in history, and your dashboard stays available while you review the updated pages.</p>
                    <Button variant="outline" className="mt-4" onClick={() => setShowRevampModal(true)}>Start website update</Button>
                  </details>}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="notifications" className="min-w-0"><NotificationPreferences /></TabsContent>

            <TabsContent value="account" className="min-w-0 space-y-6">
              <Card>
                <CardHeader><CardTitle>Your account</CardTitle><CardDescription>The account you use to sign in to SimplSEO.</CardDescription></CardHeader>
                <CardContent><p className="text-sm text-muted-foreground">Sign-in email</p><p className="mt-1 break-all font-medium">{user.email || "No email available"}</p></CardContent>
              </Card>
              <Card className="border-destructive/30">
                <CardHeader><CardTitle>Delete account</CardTitle><CardDescription>Permanently delete your account, saved recommendations, page progress, conversations, and Google connection. This cannot be undone.</CardDescription></CardHeader>
                <CardContent>
                  <Dialog open={showDeleteDialog} onOpenChange={closeDeleteDialog}>
                    <DialogTrigger asChild><Button variant="destructive"><Trash2 aria-hidden="true" className="size-4" />Delete account</Button></DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                      <DialogHeader><DialogTitle>Delete account</DialogTitle><DialogDescription>This permanently deletes your account and all associated data. This cannot be undone.</DialogDescription></DialogHeader>
                      <div className="space-y-4">
                        <p className="flex items-start gap-2 text-sm text-destructive"><AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Your saved plans, page history, conversations, and Google access will be removed.</p>
                        <div className="space-y-2"><label htmlFor="delete-confirmation" className="text-sm font-medium">Type DELETE to confirm</label><Input id="delete-confirmation" autoComplete="off" value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} disabled={isDeleting} /></div>
                        {!isGoogleUser && <div className="space-y-2"><label htmlFor="delete-password" className="text-sm font-medium">Confirm your password</label><Input id="delete-password" type="password" autoComplete="current-password" value={deletePassword} onChange={event => setDeletePassword(event.target.value)} disabled={isDeleting} /></div>}
                        {isGoogleUser && <p className="text-sm text-muted-foreground">You will also need to confirm your identity with Google.</p>}
                      </div>
                      <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => closeDeleteDialog(false)} disabled={isDeleting}>Cancel</Button>
                        <Button variant="destructive" onClick={handleDeleteAccount} disabled={isDeleting || deleteConfirmation !== "DELETE" || (!isGoogleUser && !deletePassword)}>{isDeleting && <BrandLoader className="size-4" />}{isDeleting ? "Deleting…" : "Delete account"}</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
      <RevampModal open={showRevampModal} onClose={() => setShowRevampModal(false)} />
    </MainLayout>
  );
}

export default function Settings() {
  return <Suspense fallback={<MainLayout><PageLoader label="Loading your saved settings…" /></MainLayout>}><SettingsWorkspace /></Suspense>;
}
