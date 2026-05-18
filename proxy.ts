import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

function makeSafeNext(request: NextRequest) {
  return `${request.nextUrl.pathname}${request.nextUrl.search}`
}

function setNextParam(url: URL, nextPath: string) {
  if (nextPath && nextPath !== '/login' && !nextPath.startsWith('/login?')) {
    url.searchParams.set('next', nextPath)
  }
}

function splitRelativeTarget(target: string) {
  if (!target.startsWith('/') || target.startsWith('//') || target.startsWith('/login')) {
    return { pathname: '/', search: '' }
  }

  const questionIndex = target.indexOf('?')

  if (questionIndex === -1) {
    return { pathname: target, search: '' }
  }

  return {
    pathname: target.slice(0, questionIndex) || '/',
    search: target.slice(questionIndex),
  }
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  if (pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  let response = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )

          response = NextResponse.next({
            request,
          })

          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isLoginPage = pathname.startsWith('/login')
  const isStaffPage = pathname.startsWith('/staff')
  const hasStaffCookie = Boolean(request.cookies.get('active_staff_user')?.value)

  const currentNext = request.nextUrl.searchParams.get('next') || ''
  const requestedPath = makeSafeNext(request)

  if (!user && !isLoginPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    setNextParam(url, requestedPath)
    return NextResponse.redirect(url)
  }

  if (user && isLoginPage) {
    const url = request.nextUrl.clone()

    if (hasStaffCookie) {
      const target = splitRelativeTarget(currentNext || '/')
      url.pathname = target.pathname
      url.search = target.search
      return NextResponse.redirect(url)
    }

    url.pathname = '/staff'
    url.search = ''
    setNextParam(url, currentNext || '/')
    return NextResponse.redirect(url)
  }

  if (user && !hasStaffCookie && !isStaffPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/staff'
    url.search = ''
    setNextParam(url, requestedPath)
    return NextResponse.redirect(url)
  }

  if (user && hasStaffCookie && isStaffPage) {
    const url = request.nextUrl.clone()
    const target = splitRelativeTarget(currentNext || '/')
    url.pathname = target.pathname
    url.search = target.search
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
