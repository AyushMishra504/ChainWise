import { createOpenAI } from "@ai-sdk/openai";
import { isStepCount, streamText } from "ai";
import { connection, NextResponse } from "next/server";
import { z } from "zod";
import {
  analystInterpretationSchema,
  createGetChokepointStatusTool,
  isConfiguredChokepointId,
} from "@/lib/agent/chokepoint-status";
import { agentErrorResponse } from "@/lib/agent/errors";

const requestSchema = z.object({
  chokepointId: z.string().min(1),
  question: z.string().trim().max(500).optional(),
});

const MAX_STEPS = 3;
type AgentStreamEvent =
  | { type: "investigation_started"; chokepointId: string }
  | { type: "tool_started"; toolName: string; input: unknown }
  | { type: "tool_completed"; toolName: string; output: unknown }
  | { type: "tool_failed"; toolName: string; error: string }
  | { type: "text_delta"; text: string }
  | {
      type: "analysis_completed";
      text: string;
      interpretation: unknown | null;
      interpretationError?: string;
      steps: number;
      toolCalls: unknown[];
      toolResults: unknown[];
    }
  | { type: "error"; error: string };

export async function POST(request: Request) {
  await connection();

  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    return NextResponse.json(
      { error: "GROQ_API_KEY is not configured." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "A chokepointId is required." }, { status: 400 });
  }
  if (!isConfiguredChokepointId(parsed.data.chokepointId)) {
    return NextResponse.json({ error: `Unknown configured chokepoint ID: ${parsed.data.chokepointId}` }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: AgentStreamEvent) => {
        if (request.signal.aborted) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      void (async () => {
        try {
          send({ type: "investigation_started", chokepointId: parsed.data.chokepointId });
          const groq = createOpenAI({
            apiKey: groqApiKey,
            baseURL: "https://api.groq.com/openai/v1",
          });
          const model = groq.chat(process.env.GROQ_MODEL ?? "openai/gpt-oss-20b");
          const result = streamText({
            model,
            tools: {
              getChokepointStatus: createGetChokepointStatusTool((event) => {
                if (event.type === "tool_started") {
                  send({ type: "tool_started", toolName: "getChokepointStatus", input: event.input });
                } else if (event.type === "tool_completed") {
                  send({ type: "tool_completed", toolName: "getChokepointStatus", output: event.output });
                } else {
                  send({
                    type: "tool_failed",
                    toolName: "getChokepointStatus",
                    error: event.error ?? "Tool execution failed.",
                  });
                }
              }),
            },
            abortSignal: request.signal,
            stopWhen: isStepCount(MAX_STEPS),
            system:
              "You are ChainWise's disruption analyst. You must use getChokepointStatus before answering. " +
              "Use only the tool result. Never invent values, causes, dates, or confidence. " +
              "Treat measuredStatus as the short-term traffic status and displayStatus as a UI overlay, " +
              "not as the same measurement. Use the explicit *Percent fields for percentages; do not " +
              "convert fractional fields yourself. Mention displayStatusReason when the statuses differ. " +
              "Do not say current transits are down when measuredStatus is normal. " +
              "If data is missing, say so plainly. Return ONLY valid JSON matching this shape: " +
              '{"executiveSummary":"...","currentTraffic":"...","structuralTrend":"...","nextSteps":["..."]}. ' +
              "Do not include markdown or any numeric metric not present in the tool result.",
            prompt:
              parsed.data.question ??
              `Analyze the current disruption status of configured chokepoint ${parsed.data.chokepointId}.`,
          });

          let text = "";
          for await (const delta of result.textStream) {
            text += delta;
            send({ type: "text_delta", text: delta });
          }
          if (request.signal.aborted) {
            controller.close();
            return;
          }
          const steps = await result.steps;
          const toolCalls = steps.flatMap((step) =>
            step.toolCalls.map((call) => ({ toolName: call.toolName, input: call.input })),
          );
          const toolResults = steps.flatMap((step) =>
            step.toolResults.map((toolResult) => ({ toolName: toolResult.toolName, output: toolResult.output })),
          );
          if (toolCalls.length === 0) {
            throw new Error("Groq did not invoke the required disruption-status tool.");
          }
          let interpretationInput: unknown = null;
          try {
            interpretationInput = JSON.parse(text);
          } catch {
            interpretationInput = null;
          }
          const parsedInterpretation = analystInterpretationSchema.safeParse(interpretationInput);
          send({
            type: "analysis_completed",
            text,
            interpretation: parsedInterpretation.success ? parsedInterpretation.data : null,
            interpretationError: parsedInterpretation.success
              ? undefined
              : "The model interpretation did not match the validated analyst format; verified metrics remain available.",
            steps: steps.length,
            toolCalls,
            toolResults,
          });
          controller.close();
        } catch (error) {
          const failure = agentErrorResponse(error);
          send({ type: "error", error: failure.message });
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
