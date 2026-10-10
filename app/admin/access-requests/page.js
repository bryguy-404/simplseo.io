"use client";
import { authenticatedFetch } from '../../lib/authenticatedFetch';


import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CheckCircle, XCircle, Mail, Clock, User, Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function AdminAccessRequestsPage() {
  const router = useRouter();

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("pending");

  useEffect(() => { localStorage.removeItem('adminSecret'); }, []);

  const handleLogin = async () => {
    try {
      const response = await authenticatedFetch('/api/admin/approve?status=pending');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Administrator access required.');
      setIsAuthenticated(true);
      setRequests(data.requests || []);
    } catch (error) { toast.error(error.message); }
  };

  const fetchRequests = async (status = statusFilter) => {
    setLoading(true);
    try {
      const response = await authenticatedFetch(`/api/admin/approve?status=${status}`);
      const data = await response.json();
      
      if (data.success) {
        setRequests(data.requests || []);
      } else {
        toast.error("Failed to fetch requests");
      }
    } catch (error) {
      console.error("Error fetching requests:", error);
      toast.error("Failed to fetch requests");
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (requestId) => {
    try {
      const response = await authenticatedFetch("/api/admin/approve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestId,
          action: "approve",
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        toast.success("Request approved!", {
          description: `Invitation code sent to ${data.email}`,
        });
        fetchRequests();
      } else {
        toast.error("Failed to approve request");
      }
    } catch (error) {
      console.error("Error approving request:", error);
      toast.error("Failed to approve request");
    }
  };

  const handleReject = async (requestId) => {
    try {
      const response = await authenticatedFetch("/api/admin/approve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestId,
          action: "reject",
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        toast.success("Request rejected");
        fetchRequests();
      } else {
        toast.error("Failed to reject request");
      }
    } catch (error) {
      console.error("Error rejecting request:", error);
      toast.error("Failed to reject request");
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Admin Access</CardTitle>
            <CardDescription>Sign in with your administrator account, then verify access.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button variant="outline" onClick={() => router.push('/auth')} className="w-full">Sign in</Button>
            <Button onClick={handleLogin} className="w-full">
              Verify administrator access
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">Access Requests</h1>
            <p className="text-muted-foreground">
              Review and approve access requests for SimplSEO
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant={statusFilter === "pending" ? "default" : "outline"}
              onClick={() => {
                setStatusFilter("pending");
                fetchRequests("pending");
              }}
            >
              Pending ({requests.filter(r => r.status === "pending").length})
            </Button>
            <Button
              variant={statusFilter === "approved" ? "default" : "outline"}
              onClick={() => {
                setStatusFilter("approved");
                fetchRequests("approved");
              }}
            >
              Approved
            </Button>
            <Button
              variant={statusFilter === "rejected" ? "default" : "outline"}
              onClick={() => {
                setStatusFilter("rejected");
                fetchRequests("rejected");
              }}
            >
              Rejected
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="w-8 h-8 border-4 border-[#00BF63] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading requests...</p>
          </div>
        ) : requests.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No {statusFilter} requests found</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {requests.map((request) => (
              <Card key={request.id}>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-3">
                        <Mail className="h-5 w-5 text-muted-foreground" />
                        <span className="font-semibold">{request.email}</span>
                        <Badge
                          variant={
                            request.status === "approved"
                              ? "default"
                              : request.status === "rejected"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {request.status}
                        </Badge>
                      </div>

                      {request.name && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <User className="h-4 w-4" />
                          <span>{request.name}</span>
                        </div>
                      )}

                      {request.company && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Building2 className="h-4 w-4" />
                          <span>{request.company}</span>
                        </div>
                      )}

                      {request.reason && (
                        <div className="text-sm text-muted-foreground">
                          <p className="font-medium mb-1">Reason:</p>
                          <p className="whitespace-pre-wrap">{request.reason}</p>
                        </div>
                      )}

                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>
                          Requested: {new Date(request.requestedAt).toLocaleString()}
                        </span>
                      </div>

                      {request.invitationCode && (
                        <div className="text-sm">
                          <span className="font-medium">Invitation Code: </span>
                          <span className="font-mono bg-muted px-2 py-1 rounded">
                            {request.invitationCode}
                          </span>
                        </div>
                      )}
                    </div>

                    {request.status === "pending" && (
                      <div className="flex gap-2 ml-4">
                        <Button
                          size="sm"
                          onClick={() => handleApprove(request.id)}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          <CheckCircle className="h-4 w-4 mr-2" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleReject(request.id)}
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

