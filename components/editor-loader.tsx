"use client";

import dynamic from "next/dynamic";

// The editor loads the shared drawing in the browser, so it must not be
// server-rendered.
export const EditorLoader = dynamic(
  () => import("@/components/editor").then((m) => m.Editor),
  { ssr: false }
);
