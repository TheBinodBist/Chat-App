import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import Sidebar from "#components/chat/Sidebar";
import { TooltipProvider } from "#components/ui/tooltip";
import { getCurrentUser } from "#lib/userApi";
import ChatSection from "#components/chat/Chatsection";
import CreateGroup from "#components/chat/Creategroup";

export default function Home() {
  const navigate = useNavigate();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [profileError, setProfileError] = useState("");

  useEffect(() => {
    let active = true;

    getCurrentUser()
      .then((user) => {
        if (active) setCurrentUserId(String(user.id));
      })
      .catch((error: unknown) => {
        console.error("Failed to load current user:", error);
        if (active) setProfileError("Could not load your profile.");
      });

    return () => {
      active = false;
    };
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("access");
    localStorage.removeItem("refresh");
    navigate("/login", { replace: true });
  };

  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        {currentUserId ? (
          <Sidebar currentUserId={currentUserId} onLogout={handleLogout} />
        ) : (
          <aside className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {profileError || "Loading your profile..."}
          </aside>
        )}
        <ChatSection />
      </div>
      <CreateGroup />
    </TooltipProvider>
  );
}
