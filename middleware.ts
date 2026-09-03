import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(req: NextRequest) {
  const isLoginPage = req.nextUrl.pathname.startsWith('/login')
  
  // Checks for Supabase auth cookie token
  const hasAuthToken = req.cookies.getAll().some(cookie => cookie.name.includes('sb-'))

  if (!hasAuthToken && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  if (hasAuthToken && isLoginPage) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}