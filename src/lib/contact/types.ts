export type ContactInquiryInput = {
  company: string;
  email: string;
  message: string;
  name: string;
  phone: string;
  reason: string;
};

export type ContactInquiry = ContactInquiryInput & {
  createdAt: string;
  id: string;
  ipAddress: string | null;
  status: string;
  updatedAt: string;
  userAgent: string | null;
};

export type ContactInquirySummary = Pick<
  ContactInquiry,
  "company" | "createdAt" | "email" | "id" | "name" | "phone" | "reason" | "status"
> & {
  messagePreview: string;
};

export function formatContactReason(reason: string) {
  switch (reason) {
    case "general-inquiry":
    case "general":
      return "General inquiry";
    case "partnerships":
    case "partnership":
      return "Partnership";
    case "media-inquiry":
      return "Media inquiry";
    case "investment":
      return "Investment";
    case "media":
      return "Media";
    case "support":
      return "Support";
    default:
      return reason
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join(" ");
  }
}
