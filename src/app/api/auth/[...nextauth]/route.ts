import NextAuth from "next-auth";
import { submissionAuthOptions } from "@/auth";

const handler = NextAuth(submissionAuthOptions);

export { handler as GET, handler as POST };
