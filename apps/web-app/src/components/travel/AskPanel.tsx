"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card } from "@ubi/ui";
import { openAskThread, streamAskMessage } from "./api";
import {
  WEB_TEST_IDS,
  type AskContext,
  type AskEvent,
  type AskSource,
} from "./types";

type Block =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string; sources?: AskSource[] }
  | { id: string; role: "review"; reviewId: string }
  | { id: string; role: "refused"; policy: string };

function reduceEvent(
  blocks: Block[],
  assistantId: string,
  event: AskEvent,
): Block[] {
  switch (event.type) {
    case "token": {
      const next = [...blocks];
      const idx = next.findIndex((b) => b.id === assistantId);
      const cur = idx === -1 ? undefined : next[idx];
      if (cur && cur.role === "assistant") {
        next[idx] = { ...cur, text: cur.text + event.text };
      } else {
        next.push({ id: assistantId, role: "assistant", text: event.text });
      }
      return next;
    }
    case "sources": {
      const next = [...blocks];
      const idx = next.findIndex((b) => b.id === assistantId);
      const cur = idx === -1 ? undefined : next[idx];
      if (cur && cur.role === "assistant") {
        next[idx] = { ...cur, sources: event.sources };
      } else {
        next.push({
          id: assistantId,
          role: "assistant",
          text: "",
          sources: event.sources,
        });
      }
      return next;
    }
    case "review_ready":
      return [
        ...blocks,
        { id: "r" + event.reviewId, role: "review", reviewId: event.reviewId },
      ];
    case "refused":
      return [
        ...blocks,
        { id: "x" + Date.now(), role: "refused", policy: event.policy },
      ];
    case "card":
    case "clarify":
    case "done":
    default:
      return blocks;
  }
}

/** Board 23f — Ask UBI beside the results. Same rules as the app: sources cited, live prices aged, transactions only via the review flow (opens /ask/review/[id]). */
export function AskPanel({ context }: { context: AskContext }) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const threadId = useRef<string | undefined>(undefined);
  const stop = useRef<(() => void) | undefined>(undefined);

  useEffect(() => () => stop.current?.(), []);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(undefined);
    setBusy(true);
    setBlocks((b) => [...b, { id: "u" + Date.now(), role: "user", text }]);
    try {
      if (!threadId.current) {
        const thread = await openAskThread(context);
        threadId.current = thread.id;
      }
    } catch {
      setBusy(false);
      setError(
        "Ask UBI is unavailable right now — you can still search and book with the form.",
      );
      return;
    }
    const assistantId = "a" + Date.now();
    stop.current = streamAskMessage(
      threadId.current,
      text,
      (event) => setBlocks((b) => reduceEvent(b, assistantId, event)),
      (err) => {
        setBusy(false);
        if (err)
          setError("Connection lost — your message was kept, tap send to retry.");
      },
    );
  };

  return (
    <Card
      data-testid={WEB_TEST_IDS.ask.panel}
      className="flex w-[320px] shrink-0 flex-col overflow-hidden rounded-2xl"
    >
      <div className="flex items-center gap-2 border-b border-[#F0F0F0] p-4">
        <span
          className="inline-block h-4 w-4 rotate-45 rounded-sm bg-[#1DB954]"
          aria-hidden
        />
        <span className="font-heading text-sm font-semibold text-[#191414]">
          Ask UBI
        </span>
        <span className="ml-auto text-[11px] text-[#666]">same rules as the app</span>
      </div>
      <div className="flex-1 space-y-2.5 overflow-auto p-4 text-[12.5px] leading-relaxed text-[#191414]">
        {blocks.length === 0 && !error ? (
          <p className="text-[#666]">
            Ask about these flights — which lets you change the day for free, what a Saver
            refund covers, or whether protection is offered.
          </p>
        ) : null}
        {blocks.map((b) => {
          if (b.role === "user") {
            return (
              <div
                key={b.id}
                className="ml-8 rounded-xl rounded-br-sm bg-[#F5F5F5] px-2.5 py-2"
              >
                {b.text}
              </div>
            );
          }
          if (b.role === "assistant") {
            return (
              <div key={b.id}>
                {b.text ? <p>{b.text}</p> : null}
                {b.sources?.length ? (
                  <div className="mt-2 border-l-2 border-[#E5E5E5] pl-2.5 text-[11.5px] text-[#666]">
                    Sources: {b.sources.map((s) => s.title).join(" · ")}
                  </div>
                ) : null}
              </div>
            );
          }
          if (b.role === "review") {
            return (
              <Link
                key={b.id}
                href={"/ask/review/" + b.reviewId}
                className="inline-flex rounded-full bg-[#191414] px-3.5 py-2 text-[12px] font-semibold text-white"
              >
                Review &amp; book
              </Link>
            );
          }
          return (
            <p key={b.id} className="text-[#666]">
              That isn&apos;t something Ask UBI can do here — use the regular screen, it opens
              with everything you need.
            </p>
          );
        })}
        {error ? <p className="text-[12px] text-[#C53030]">{error}</p> : null}
      </div>
      <form
        className="border-t border-[#F0F0F0] p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about these flights…"
          className="h-10 w-full rounded-full bg-[#F5F5F5] px-3.5 text-[12.5px] outline-none"
        />
      </form>
    </Card>
  );
}
