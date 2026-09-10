import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { readPublicSupabaseEnv } from "@/lib/supabase/env";
const protectedPaths = ["/library", "/history", "/settings"];
export async function middleware(request: NextRequest) {
  if (
    !protectedPaths.some(
      (path) =>
        request.nextUrl.pathname === path || request.nextUrl.pathname.startsWith(`${path}/`),
    )
  )
    return NextResponse.next();
  let environment;
  try {
    environment = readPublicSupabaseEnv();
  } catch {
    return NextResponse.next();
  }
  let response = NextResponse.next({ request });
  const client = createServerClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values) {
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  const result = await client.auth.getUser();
  if (!result.data.user) {
    const login = new URL("/", request.url);
    login.searchParams.set("auth", "required");
    return NextResponse.redirect(login);
  }
  return response;
}
export const config = { matcher: ["/library/:path*", "/history/:path*", "/settings/:path*"] };
