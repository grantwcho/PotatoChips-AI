export type DirectRunStreamEvent<
  Message,
  Session,
  Result
> =
  | {
      text: string;
      type: "stdout";
    }
  | {
      activeSessionId?: string | null;
      messages?: Message[];
      result?: Result;
      sessions?: Session[];
      type: "done";
    }
  | {
      error?: string;
      type: "error";
    };

export async function readDirectRunStream<Message, Session, Result>(
  response: Response,
  onEvent: (event: DirectRunStreamEvent<Message, Session, Result>) => void
) {
  const reader = response.body?.getReader();

  if (!reader) {
    throw new Error("This browser could not read the agent stream.");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  const flushLine = (line: string) => {
    const trimmed = line.trim();

    if (!trimmed) {
      return;
    }

    onEvent(JSON.parse(trimmed) as DirectRunStreamEvent<Message, Session, Result>);
  };

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (buffer.includes("\n")) {
      const newlineIndex = buffer.indexOf("\n");
      const line = buffer.slice(0, newlineIndex);

      buffer = buffer.slice(newlineIndex + 1);
      flushLine(line);
    }
  }

  buffer += decoder.decode();
  flushLine(buffer);
}
