export function agentErrorResponse(error: unknown): { message: string; status: 429 | 502 } {
  const message = error instanceof Error ? error.message : "Agent analysis failed.";
  const errorRecord = typeof error === "object" && error !== null ? (error as { statusCode?: number }) : null;
  const isRateLimited =
    errorRecord?.statusCode === 429 || /rate limit|quota|too many requests/i.test(message);
  return {
    message: isRateLimited ? "Groq rate limit reached. Please try again shortly." : message,
    status: isRateLimited ? 429 : 502,
  };
}
