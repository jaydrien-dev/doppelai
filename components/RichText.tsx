"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

/**
 * Rich text renderer — markdown with GFM (tables, strikethrough, task lists).
 */
export function RichText({ children }: { children: string }) {
  return (
    <div className="rich-text">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

const components: Components = {
  code({ className, children, ...props }) {
    const text = String(children).replace(/\n$/, "");

    /* Inline code (no language class, no newlines). */
    if (!className && !text.includes("\n")) {
      return (
        <code className="rich-inline-code" {...props}>
          {children}
        </code>
      );
    }

    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },

  pre({ children }) {
    return <pre className="rich-code-block">{children}</pre>;
  },

  table({ children }) {
    return (
      <div className="rich-table-wrap">
        <table>{children}</table>
      </div>
    );
  },
};
