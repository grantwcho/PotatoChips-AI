import { createContactInquiry } from "@/lib/contact/inquiries";

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getRequestIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || null;
  }

  return request.headers.get("x-real-ip");
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const payload = {
      name: getString(formData, "name"),
      company: getString(formData, "company"),
      email: getString(formData, "email"),
      phone: getString(formData, "phone"),
      reason: getString(formData, "reason"),
      message: getString(formData, "message"),
    };

    if (!payload.name || !payload.email || !payload.reason || !payload.message) {
      return Response.json(
        { error: "Name, email, reason, and message are required." },
        { status: 400 }
      );
    }

    await createContactInquiry(payload, {
      ipAddress: getRequestIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to submit contact inquiry.";

    return Response.json({ error: message }, { status: 400 });
  }
}
