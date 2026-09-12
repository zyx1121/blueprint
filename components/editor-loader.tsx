"use client";

import dynamic from "next/dynamic";

// The editor reads localStorage for its initial state, so it must not be
// server-rendered.
export const EditorLoader = dynamic(
  () => import("@/components/editor").then((m) => m.Editor),
  { ssr: false }
);
