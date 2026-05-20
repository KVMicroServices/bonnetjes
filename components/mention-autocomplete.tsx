"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface UserResult {
  id: string;
  name: string | null;
  email: string;
}

interface MentionAutocompleteProps {
  query: string;
  visible: boolean;
  onSelect: (user: UserResult) => void;
  onDismiss: () => void;
  anchorElement: HTMLTextAreaElement | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEBOUNCE_DELAY_MS = 300;
const MINIMUM_QUERY_LENGTH = 2;

// ─── Component ───────────────────────────────────────────────────────────────

export function MentionAutocomplete({
  query,
  visible,
  onSelect,
  onDismiss,
  anchorElement,
}: MentionAutocompleteProps) {
  const [users, setUsers] = useState<UserResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Debounced Search ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!visible || query.length < MINIMUM_QUERY_LENGTH) {
      setUsers([]);
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
        if (response.ok) {
          const data = await response.json();
          setUsers(data.users);
          setActiveIndex(0);
        }
      } catch {
        setUsers([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_DELAY_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query, visible]);

  // ─── Keyboard Navigation ─────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!visible || users.length === 0) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((previous) => {
          if (previous < users.length - 1) {
            return previous + 1;
          }
          return 0;
        });
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((previous) => {
          if (previous > 0) {
            return previous - 1;
          }
          return users.length - 1;
        });
      } else if (event.key === "Enter") {
        event.preventDefault();
        const selectedUser = users[activeIndex];
        if (selectedUser) {
          onSelect(selectedUser);
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
      }
    },
    [visible, users, activeIndex, onSelect, onDismiss]
  );

  useEffect(() => {
    if (!anchorElement) {
      return;
    }

    anchorElement.addEventListener("keydown", handleKeyDown);
    return () => {
      anchorElement.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchorElement, handleKeyDown]);

  // ─── Position Calculation ────────────────────────────────────────────────────

  const [position, setPosition] = useState<{ top: number; left: number; showAbove: boolean }>({
    top: 0,
    left: 0,
    showAbove: false,
  });

  useEffect(() => {
    if (!visible || !anchorElement) {
      return;
    }

    const anchorRect = anchorElement.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - anchorRect.bottom;
    const showAbove = spaceBelow < 200;

    if (showAbove) {
      setPosition({
        top: anchorRect.top - 8,
        left: anchorRect.left,
        showAbove: true,
      });
    } else {
      setPosition({
        top: anchorRect.bottom + 4,
        left: anchorRect.left,
        showAbove: false,
      });
    }
  }, [visible, anchorElement]);

  // ─── Render ──────────────────────────────────────────────────────────────────

  if (!visible) {
    return null;
  }

  if (loading && users.length === 0) {
    return (
      <div
        ref={dropdownRef}
        className="fixed z-[100] w-64 rounded-lg border border-gray-200 bg-white p-2 shadow-lg"
        style={{
          top: position.showAbove ? "auto" : `${position.top}px`,
          bottom: position.showAbove ? `${window.innerHeight - position.top}px` : "auto",
          left: `${position.left}px`,
        }}
      >
        <div className="px-3 py-2 text-sm text-gray-500">Searching...</div>
      </div>
    );
  }

  if (users.length === 0) {
    return null;
  }

  return (
    <div
      ref={dropdownRef}
      className="fixed z-[100] w-64 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg"
      style={{
        top: position.showAbove ? "auto" : `${position.top}px`,
        bottom: position.showAbove ? `${window.innerHeight - position.top}px` : "auto",
        left: `${position.left}px`,
      }}
    >
      {users.map((user, index) => (
        <button
          key={user.id}
          type="button"
          className={`flex w-full flex-col px-3 py-2 text-left transition-colors ${
            index === activeIndex ? "bg-blue-50" : "hover:bg-gray-50"
          }`}
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(user);
          }}
          onMouseEnter={() => setActiveIndex(index)}
        >
          <span className="text-sm font-medium text-gray-900">
            {user.name ? user.name : user.email}
          </span>
          {user.name && (
            <span className="text-xs text-gray-500">{user.email}</span>
          )}
        </button>
      ))}
    </div>
  );
}
